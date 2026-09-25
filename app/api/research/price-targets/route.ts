export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const base = process.env.RESEARCH_MONITOR_URL;
  const token = process.env.RESEARCH_MONITOR_TOKEN;
  if (!base || !token) return Response.json({ ok: false, items: [] }, { status: 503, headers });
  try {
    const url = new URL(base);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local)) throw new Error("HTTPS required");
    url.pathname = `${url.pathname.replace(/\/$/, "")}/price-targets`;
    url.search = "";
    url.hash = "";
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 100_000) throw new Error("Monitor unavailable");
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("ok" in payload) || payload.ok !== true ||
        !("items" in payload) || !Array.isArray(payload.items) || payload.items.length > 30) throw new Error("Invalid payload");
    return Response.json(payload, { headers });
  } catch {
    return Response.json({ ok: false, items: [] }, { status: 503, headers });
  }
}
