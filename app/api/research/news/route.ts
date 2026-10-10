import { buildPublicNews } from "@/lib/research/public-news-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET() {
  const startedAt = performance.now();
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const base = process.env.RESEARCH_MONITOR_URL;
    const token = process.env.RESEARCH_MONITOR_TOKEN;
    if (!base || !token) throw new Error("Not configured");
    const url = new URL(base);
    if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
      throw new Error("Invalid monitor");
    }
    url.pathname = `${url.pathname.replace(/\/$/, "")}/news`; url.search = ""; url.hash = "";
    if (process.env.VERCEL_ENV === "preview") url.searchParams.set("originalPreview", "1");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("News unavailable");
    const text = await response.text();
    if (new TextEncoder().encode(text).length > 500_000) throw new Error("Oversized response");
    const upstreamMs = performance.now() - startedAt;
    const raw = JSON.parse(text);
    const feed = buildPublicNews(raw, { allowOriginalPreview: process.env.VERCEL_ENV === "preview" });
    return Response.json(feed, { headers: { ...headers,
      "Server-Timing": `upstream;dur=${upstreamMs.toFixed(1)},total;dur=${(performance.now() - startedAt).toFixed(1)}`,
    } });
  } catch {
    // A monitor outage is not an empty, successfully refreshed news feed.
    return Response.json({ ok: false, enabled: false, items: [] }, { status: 503, headers });
  }
}
