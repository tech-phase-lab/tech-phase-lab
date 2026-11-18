import { parseCompanyWire } from "@/lib/research/company-wire";
import { buildPublicNews } from "@/lib/research/public-news-response";
import { freeTechSelection, projectFreeWire } from "@/lib/research/tech-news-access";
import { PRIVATE_HEADERS, readMonitor, viewerHasFullNews } from "@/lib/research/tech-news-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const headers = PRIVATE_HEADERS;

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
    // The membership check and, for FREE, the news read that decides the newest five run alongside the wire read (owner, Nov 18).
    const fullAccess = viewerHasFullNews();
    const freeFeed = fullAccess.then(full => full ? null : readMonitor("news", 500_000, 5_000).then(raw => ({ feed: buildPublicNews(raw) })).catch(() => null));
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Unavailable");
    const text = await response.text();
    if (new TextEncoder().encode(text).length > 400_000) throw new Error("Oversized response");
    const wire = parseCompanyWire(JSON.parse(text));
    if (await fullAccess) return Response.json(wire, { headers });
    // FREE: only the headlines inside the same 30-minute-delayed newest five that /api/research/news allows.
    // The selection needs the news feed too; without it nothing is sent rather than everything.
    const read = await freeFeed;
    if (!read) throw new Error("News unavailable");
    const { feed } = read;
    return Response.json({ ok: true, items: projectFreeWire(wire.items, freeTechSelection(feed, wire.items)) }, { headers });
  } catch {
    return Response.json({ ok: false, items: {} }, { status: 503, headers });
  }
}
