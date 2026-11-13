import { createHmac } from "node:crypto";
import { getMembership } from "@/lib/membership/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

async function monitor(path: string, body?: unknown) {
  const base = process.env.RESEARCH_MONITOR_URL;
  const token = process.env.RESEARCH_MONITOR_TOKEN;
  if (!base || !token) throw new Error("Unavailable");
  const url = new URL(base);
  if (url.protocol !== "https:") throw new Error("HTTPS required");
  url.pathname = path; url.search = ""; url.hash = ""; url.username = ""; url.password = "";
  const response = await fetch(url, { method: body ? "POST" : "GET", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    // A refusal with a known reason is passed on, so the screen can say why (Nov 13: every refusal read "could not connect").
    if (response.status === 400) {
      const refusal = await response.json().catch(() => null) as { ok?: unknown; error?: unknown } | null;
      if (refusal && refusal.ok === false && typeof refusal.error === "string" && REFUSALS.has(refusal.error)) return { ok: false, error: refusal.error };
    }
    throw new Error("Unavailable");
  }
  return response.json();
}
const REFUSALS = new Set(["not-owned", "expired-membership", "not-registered", "disabled", "invalid-member", "invalid-subscription",
  "subscription-mismatch", "device-owned-by-another-member", "member-device-limit", "invalid-preferences", "invalid-registration"]);
export async function GET() {
  try {
    const member = await getMembership();
    if (member.status === "unavailable") return Response.json({ enabled: false }, { status: 503, headers });
    if (member.status !== "signed-in") return Response.json({ enabled: false, reason: "sign-in" }, { headers });
    if (member.plan !== "pro" || !Number.isFinite(member.accessExpiresAt) || member.accessExpiresAt <= Date.now()) return Response.json({ enabled: false, reason: "pro-required" }, { headers });
    const config = await monitor("/push/config");
    return Response.json({ enabled: config.enabled === true && config.memberAccessVersion === 1,
      publicKey: config.memberAccessVersion === 1 ? config.publicKey : "", validUntil: member.accessExpiresAt,
      preferencesVersion: config.preferencesVersion === 1 ? 1 : 0 }, { headers });
  } catch { return Response.json({ enabled: false }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin ||
      !request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ ok: false }, { status: 403, headers });
  }
  try {
    const member = await getMembership();
    if (member.status === "unavailable") return Response.json({ ok: false }, { status: 503, headers });
    if (member.status !== "signed-in") return Response.json({ ok: false, error: "sign-in" }, { status: 401, headers });
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing body");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) { await reader.cancel(); throw new Error("Too large"); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || !["register", "remove", "status", "test", "preferences", "save-preferences"].includes(body.action)) throw new Error("Invalid action");
    if (body.action !== "remove" && (member.plan !== "pro" || !Number.isFinite(member.accessExpiresAt) || member.accessExpiresAt <= Date.now())) {
      return Response.json({ ok: false, error: "pro-required" }, { status: 403, headers });
    }
    // Weekly-draft notices are the owner's alone; a member's request for them is refused, never silently stored.
    if (body.preferences && typeof body.preferences === "object" && (body.preferences as { weeklyDraft?: unknown }).weeklyDraft === true && !member.isAdmin) return Response.json({ ok: false, error: "owner-required" }, { status: 403, headers });
    const result = await monitor(`/push/member/${body.action}`, {
      memberId: member.userId, accessExpiresAt: member.accessExpiresAt / 1000,
      // The key the question board uses for this member, so "your question was answered" reaches its asker only.
      questionOwner: createHmac("sha256", process.env.RESEARCH_MONITOR_TOKEN ?? "").update(`question:${member.userId}`).digest("hex"),
      subscription: body.subscription, tickers: body.tickers, allTargets: body.allTargets === true, language: body.language,
      ...(body.weeklyNotebook === undefined ? {} : { weeklyNotebook: body.weeklyNotebook !== false }),
      ...(body.preferences === undefined ? {} : { preferences: body.preferences }),
    });
    return Response.json(result, { headers });
  } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
