import { buildPublicNews } from "@/lib/research/public-news-response";
import { parseCompanyWire } from "@/lib/research/company-wire";
import { freeTechSelection, projectFreeNews } from "@/lib/research/tech-news-access";
import { PRIVATE_HEADERS, readMonitor, viewerHasFullNews } from "@/lib/research/tech-news-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET() {
  const startedAt = performance.now();
  const headers = PRIVATE_HEADERS;
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
    // The membership check and, for FREE, the company headlines that decide the newest five run alongside the news read instead of
    // after it: the alerts page waits for this answer behind its loader (owner, Nov 18). A PRO viewer never triggers the wire read.
    const fullAccess = viewerHasFullNews();
    const freeWire = fullAccess.then(full => full ? null : readMonitor("company-wire", 400_000, 2_500).then(raw => parseCompanyWire(raw).items).catch(() => null));
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("News unavailable");
    const text = await response.text();
    if (new TextEncoder().encode(text).length > 500_000) throw new Error("Oversized response");
    const upstreamMs = performance.now() - startedAt;
    const raw = JSON.parse(text);
    const full = await fullAccess;
    let feed = buildPublicNews(raw, { allowOriginalPreview: full && process.env.VERCEL_ENV === "preview" });
    if (!full) {
      // FREE: the watched companies' stories are limited here, before anything is sent (30 minutes behind, newest five, headlines only).
      // No wire: the other sources still limit themselves.
      const wire = (await freeWire) ?? {};
      feed = projectFreeNews(feed, freeTechSelection(feed, wire));
    }
    return Response.json(feed, { headers: { ...headers,
      "Server-Timing": `upstream;dur=${upstreamMs.toFixed(1)},total;dur=${(performance.now() - startedAt).toFixed(1)}`,
    } });
  } catch {
    // A monitor outage is not an empty, successfully refreshed news feed.
    return Response.json({ ok: false, enabled: false, items: [] }, { status: 503, headers });
  }
}
