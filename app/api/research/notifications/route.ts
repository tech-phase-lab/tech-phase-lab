import { createHmac } from "node:crypto";
import { getMembership } from "@/lib/membership/server";
import { isOwnerAccount } from "@/lib/membership/entitlements";
import { cleanPushDiagnostic, createPushDiagnosticLimiter, pushDiagnosticLine } from "@/lib/research/push-diagnostic";
import { cleanPushSendLog } from "@/lib/research/push-send-log";
import { cleanPushServerNotice, PUSH_NOTICE_ACTIONS } from "@/lib/research/push-server-notice";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const diagnosticAllowed = createPushDiagnosticLimiter();

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
  "subscription-mismatch", "device-owned-by-another-member", "member-device-limit", "invalid-preferences", "invalid-registration", "invalid-notice"]);
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
    // Nov 15: the owner's notification step record (times, yes/no answers, worker version, a random per-notice id) as one log line.
    // Owner accounts only, rate limited; nothing is sent on to the monitor and nothing about the member is logged.
    if (body?.action === "diagnostic") {
      if (!isOwnerAccount(member.userId)) return Response.json({ ok: false, error: "owner-required" }, { status: 403, headers });
      const record = cleanPushDiagnostic(body.record);
      if (!record) return Response.json({ ok: false }, { status: 400, headers });
      if (!diagnosticAllowed(member.userId, Date.now())) return Response.json({ ok: false, error: "rate-limited" }, { status: 429, headers });
      console.info(`[push-diag] ${pushDiagnosticLine(record)}`);
      return Response.json({ ok: true }, { headers });
    }
    // Nov 16: the monitor's last sends (short device hash, push service host, its HTTP status, whether the device is still registered),
    // for the owner's panel. Owner accounts only; cleaned again here so nothing else can reach the page.
    if (body?.action === "send-log") {
      if (!isOwnerAccount(member.userId)) return Response.json({ ok: false, error: "owner-required" }, { status: 403, headers });
      const log = await monitor("/push/send-log");
      return Response.json({ ok: true, items: cleanPushSendLog(log?.items) }, { headers });
    }
    // Nov 16: the newest notice the server sent this member's current device (and opening or dismissing it), so the app can show its
    // own banner without the service worker. Any signed-in member, FREE or PRO: it only reads or closes a notice this device was already
    // sent, and the monitor answers only for the member's own registered subscription. Only the cleaned notice reaches the page.
    if ((PUSH_NOTICE_ACTIONS as readonly string[]).includes(body?.action)) {
      const result = await monitor(`/push/member/${body.action}`, { memberId: member.userId, subscription: body.subscription,
        ...(body.action === "notice-opened" || body.action === "notice-dismissed" ? { noticeId: typeof body.noticeId === "string" ? body.noticeId : "" } : {}) });
      if (result?.ok === false) return Response.json(result, { headers });
      if (body.action === "notice-opened" || body.action === "notice-dismissed") return Response.json({ ok: true, marked: result?.marked === true }, { headers });
      return Response.json({ ok: true, registered: result?.registered === true, notice: cleanPushServerNotice(result?.notice) }, { headers });
    }
    if (!body ||!["register", "remove", "status", "test", "preferences", "save-preferences"].includes(body.action)) throw new Error("Invalid action");
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
