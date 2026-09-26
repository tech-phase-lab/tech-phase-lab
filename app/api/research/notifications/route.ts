import { timingSafeEqual } from "node:crypto";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

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
  if (!process.env.WEB_PUSH_PILOT_CODE) return Response.json({ enabled: false }, { headers });
  try { return Response.json(await monitor("/push/config"), { headers }); }
  catch { return Response.json({ enabled: false }, { headers }); }
}
export async function POST(request: Request) {
  // A private pilot enrollment code is required until member authentication ships.
  // It is never sent to the client, stored in browser storage, or logged.
  if (request.headers.get("origin") !== new URL(request.url).origin ||
      !request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ ok: false }, { status: 403, headers });
  }
  const expected = process.env.WEB_PUSH_PILOT_CODE;
  if (!expected || expected.length < 24) return Response.json({ ok: false }, { status: 503, headers });
  try {
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
    const supplied = Buffer.from(typeof body.code === "string" ? body.code : "");
    const secret = Buffer.from(expected);
    if (supplied.length !== secret.length || !timingSafeEqual(supplied, secret)) {
      return Response.json({ ok: false }, { status: 403, headers });
    }
    if (!["register", "remove"].includes(body.action)) throw new Error("Invalid action");
    const result = await monitor(`/push/${body.action}`, {
      subscription: body.subscription, tickers: body.tickers, allTargets: body.allTargets === true, language: body.language,
    });
    return Response.json(result, { headers });
  } catch { return Response.json({ ok: false }, { status: 400, headers }); }
}
