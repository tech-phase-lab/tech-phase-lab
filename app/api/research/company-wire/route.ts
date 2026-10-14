import { parseCompanyWire } from "@/lib/research/company-wire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET() {
  try {
    const base = process.env.RESEARCH_MONITOR_URL;
    const token = process.env.RESEARCH_MONITOR_TOKEN;
    if (!base || !token) throw new Error("Not configured");
    const url = new URL(base);
    if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
      throw new Error("Invalid monitor");
    }
    url.pathname = `${url.pathname.replace(/\/$/, "")}/company-wire`; url.search = ""; url.hash = "";
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Unavailable");
    const text = await response.text();
    if (new TextEncoder().encode(text).length > 400_000) throw new Error("Oversized response");
    return Response.json(parseCompanyWire(JSON.parse(text)), { headers });
  } catch {
    return Response.json({ ok: false, items: {} }, { status: 503, headers });
  }
}
