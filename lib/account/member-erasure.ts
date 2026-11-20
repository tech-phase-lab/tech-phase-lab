// Member erasure after a Clerk account is deleted (退会). Owner-approved design, 2026-11-20.
// OFF unless MEMBER_ERASURE_ENABLED is exactly "true". Clerk's user.deleted webhook (Svix-signed with
// CLERK_WEBHOOK_SIGNING_SECRET) reaches app/api/webhooks/clerk; this module checks the signature, refuses the
// owner accounts and asks the research monitor to erase that member's data and queue the Postgres steps
// (scripts/member-erasure-job.mjs). It never deletes a Clerk account, and never logs a member id or a key.
import { createHmac, timingSafeEqual } from "node:crypto";
import { isOwnerAccount } from "../membership/entitlements.ts";

export type Env = Record<string, string | undefined>;
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export const MEMBER_ID = /^user_[A-Za-z0-9]{1,128}$/;
const TOLERANCE_SECONDS = 5 * 60;

export function erasureEnabled(env: Env): boolean {
  return (env.MEMBER_ERASURE_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** Never erased by an automatic job: the owner accounts, and anything that is not a plain Clerk user id. */
export function erasureRefused(userId: unknown): "owner-account" | "invalid-member" | null {
  if (typeof userId !== "string" || !MEMBER_ID.test(userId) || userId.startsWith("user_erased")) return "invalid-member";
  return isOwnerAccount(userId) ? "owner-account" : null;
}

/** Svix signature check (Clerk webhooks): v1 = base64(HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)). */
export function verifySvix(secret: string | undefined, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, now = Date.now()): boolean {
  if (!secret || !secret.startsWith("whsec_") || !headers.id || !headers.timestamp || !headers.signature) return false;
  if (!/^\d{1,12}$/.test(headers.timestamp) || Math.abs(now / 1000 - Number(headers.timestamp)) > TOLERANCE_SECONDS) return false;
  let key: Buffer;
  try { key = Buffer.from(secret.slice(6), "base64"); } catch { return false; }
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${body}`).digest();
  return headers.signature.split(" ").some(part => {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** The keys the website already uses for this member's monitor records (same derivations as the routes). */
export function memberKeys(token: string, userId: string) {
  const key = (namespace: string) => createHmac("sha256", token).update(`${namespace}:${userId}`).digest("hex");
  return { savedResearch: key("saved-research"), favorites: key("favorites"), question: key("question"), deskReaction: key("desk-reaction") };
}

function monitorUrl(env: Env, path: string) {
  const token = env.RESEARCH_MONITOR_TOKEN, base = env.RESEARCH_MONITOR_URL;
  if (!token || !base) return null;
  const url = new URL(base);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname) && env.NODE_ENV !== "production";
  if (url.username || url.password || (url.protocol !== "https:" && !local)) return null;
  url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`; url.search = ""; url.hash = "";
  return { url: url.href, token };
}

export type WebhookResult = { status: number; body: Record<string, unknown> };

/**
 * One Clerk webhook delivery. Non-2xx answers make Svix retry, so anything not finished answers 503.
 * user.deleted for an owner account answers 200 without touching anything (a retry would not change that).
 */
export async function handleClerkWebhook(input: { env: Env; body: string; headers: { id: string | null; timestamp: string | null; signature: string | null }; fetch: Fetch; now?: number }): Promise<WebhookResult> {
  const { env, body } = input;
  if (!verifySvix(env.CLERK_WEBHOOK_SIGNING_SECRET, input.headers, body, input.now)) return { status: 401, body: { ok: false } };
  let event: { type?: unknown; data?: { id?: unknown; deleted?: unknown } };
  try { event = JSON.parse(body); } catch { return { status: 400, body: { ok: false } }; }
  if (event?.type !== "user.deleted") return { status: 200, body: { ok: true, status: "ignored" } };
  const refused = erasureRefused(event.data?.id);
  if (refused === "owner-account") {
    console.warn(JSON.stringify({ event: "member-erasure-refused", reason: refused }));
    return { status: 200, body: { ok: true, status: "owner-account-refused" } };
  }
  if (refused) return { status: 400, body: { ok: false, error: refused } };
  if (!erasureEnabled(env)) return { status: 503, body: { ok: false, error: "disabled" } };
  const target = monitorUrl(env, "/member/erase");
  if (!target) return { status: 503, body: { ok: false, error: "unconfigured" } };
  const userId = event.data!.id as string;
  try {
    const response = await input.fetch(target.url, {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${target.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ memberId: userId, keys: memberKeys(target.token, userId) }),
    });
    const value = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (response.status !== 200 || value?.ok !== true || value.status !== "erased") {
      console.error(JSON.stringify({ event: "member-erasure-failed", stage: "monitor", status: response.status }));
      return { status: 503, body: { ok: false } };
    }
    const counts = Object.fromEntries(Object.entries(value).filter(([k, v]) => typeof v === "number" && k !== "receipt"));
    console.info(JSON.stringify({ event: "member-erasure", stage: "monitor", ...counts }));
    return { status: 200, body: { ok: true, status: "erased" } };
  } catch (error) {
    console.error(JSON.stringify({ event: "member-erasure-failed", stage: "monitor", error: error instanceof Error ? error.name : "unknown" }));
    return { status: 503, body: { ok: false } };
  }
}
