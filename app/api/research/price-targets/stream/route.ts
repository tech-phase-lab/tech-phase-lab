import { createHmac } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A short-lived, origin-bound ticket only permits this public feed. The monitor
// API token remains on the server and cannot be recovered from the ticket.
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const base = process.env.RESEARCH_MONITOR_URL;
  const secret = process.env.RESEARCH_MONITOR_TOKEN;
  if (!base || !secret) return Response.json({ ok: false }, { status: 503, headers });
  const origin = new URL(request.url).origin;
  if ((request.headers.get("origin") && request.headers.get("origin") !== origin) ||
      request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ ok: false }, { status: 403, headers });
  }
  try {
    const url = new URL(base);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local)) throw new Error("HTTPS required");
    url.pathname = `${url.pathname.replace(/\/$/, "")}/price-targets/events`;
    url.search = "";
    url.hash = "";
    url.username = "";
    url.password = "";
    const exp = Math.floor(Date.now() / 1000) + 780;
    const payload = Buffer.from(JSON.stringify({ purpose: "tech-phase-price-target-stream-v1", origin, exp })).toString("base64url");
    const signature = createHmac("sha256", secret).update(payload).digest("base64url");
    return Response.json({ ok: true, url: url.toString(), ticket: `${payload}.${signature}`, expiresAt: exp }, { headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
