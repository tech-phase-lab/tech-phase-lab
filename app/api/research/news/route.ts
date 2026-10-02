import { availableNewsPayload, type OfficialUpdate } from "@/lib/research/general-news";
import { officialResultEvents } from "@/lib/research/official-result-events";
import { muFlash } from '@/lib/research/mu-latest';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET() {
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
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("News unavailable");
    const text = await response.text();
    if (new TextEncoder().encode(text).length > 500_000) throw new Error("Oversized response");
    const raw = JSON.parse(text);
    const payload = availableNewsPayload(raw);
    let issuerEvents: ReturnType<typeof officialResultEvents> = [];
    try { issuerEvents=officialResultEvents(raw.officialResearch); } catch { /* An invalid note must not suppress valid news. */ }
    payload.officialUpdates = (payload.officialUpdates ?? []).map(item => {
      const event = issuerEvents.find(e => e.sources[0].url === item.url);
      return event ? { ...item, researchId: event.id, title: event.title.en, translationJa: event.title.ja } : item;
    });
    const resultUpdates = (payload.resultBriefs ?? []).map(r => ({id:r.id,title:r.titleEn,translationJa:r.titleJa,url:r.url,publisher:r.publisher,tickers:[r.ticker],observedAt:r.observedAt,publishedAt:r.publishedAt,researchId:r.kind === 'earnings' ? r.researchId : undefined}));
    const fallback = issuerEvents.some(e => e.ticker === "MU" && e.kind === "earnings") ? [] : [muFlash];
    const merged: OfficialUpdate[] = [...resultUpdates, ...fallback, ...(payload.officialUpdates ?? []).filter(item => item.url !== muFlash.url && !resultUpdates.some(r => r.url === item.url))];
    payload.officialUpdates = merged.toSorted((a,b)=>Date.parse(b.publishedAt ?? b.observedAt)-Date.parse(a.publishedAt ?? a.observedAt)).slice(0,20);
    return Response.json(payload, { headers });
  } catch {
    return Response.json({ ok: true, enabled:false, items: [], officialUpdates:[muFlash] }, { headers });
  }
}
