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
  if (!response.ok) throw new Error("Unavailable");
  return response.json();
}
export async function GET() {
  try {
    const member = await getMembership();
    if (member.status === "unavailable") return Response.json({ enabled: false }, { status: 503, headers });
    if (member.status !== "signed-in") return Response.json({ enabled: false, reason: "sign-in" }, { headers });
    if (member.plan !== "pro") return Response.json({ enabled: false, reason: "pro-required" }, { headers });
    const config = await monitor("/push/config");
    return Response.json({ enabled: config.enabled === true && config.memberAccessVersion === 1,
      publicKey: config.memberAccessVersion === 1 ? config.publicKey : "", validUntil: member.accessExpiresAt }, { headers });
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
    if (!["register", "remove", "status", "test"].includes(body.action)) throw new Error("Invalid action");
    if (body.action !== "remove" && (member.plan !== "pro" || !Number.isFinite(member.accessExpiresAt) || member.accessExpiresAt <= Date.now())) {
      return Response.json({ ok: false, error: "pro-required" }, { status: 403, headers });
    }
    const result = await monitor(`/push/member/${body.action}`, {
      memberId: member.userId, accessExpiresAt: member.accessExpiresAt / 1000,
      subscription: body.subscription, tickers: body.tickers, allTargets: body.allTargets === true, language: body.language,
    });
    return Response.json(result, { headers });
  } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
