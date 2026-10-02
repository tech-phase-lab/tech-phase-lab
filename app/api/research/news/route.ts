import { availableNewsPayload, publicNewsPayload, type OfficialUpdate } from "@/lib/research/general-news";
import { officialResultEvents } from "@/lib/research/official-result-events";
import { mergeResultNews } from "@/lib/research/result-news";
import { muFlash, muLatest } from '@/lib/research/mu-latest';

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
    const issuerEvents: ReturnType<typeof officialResultEvents> = [];
    if (Array.isArray(raw.officialResearch) && raw.officialResearch.length <= 20) {
      for (const note of raw.officialResearch) {
        try { issuerEvents.push(...officialResultEvents([note])); } catch { /* Isolate a rejected note from valid notes. */ }
      }
    }
    payload.officialUpdates = (payload.officialUpdates ?? []).map(item => {
      const event = issuerEvents.find(e => e.sources[0].url === item.url);
      if (!event) return item;
      // Research titles permit 400 characters, while public headlines permit
      // 180. Preserve a valid headline instead of poisoning the whole feed in
      // the browser when a longer research title is added here.
      const titles = Array.from(event.title.en).length <= 180 && Array.from(event.title.ja).length <= 180
        ? { shortTitleJa: undefined, shortTitleEn: undefined, title: event.title.en, translationJa: event.title.ja }
        : {};
      const enriched = { ...item, ...titles, researchId: event.id, bodyJa: [event.summary.ja, ...event.facts.map(f => f.text.ja)].join("\n\n"), bodyEn: [event.summary.en, ...event.facts.map(f => f.text.en)].join("\n\n") };
      try {
        return publicNewsPayload({ ...payload, officialUpdates: [enriched] }).officialUpdates![0];
      } catch {
        return item;
      }
    });
    const resultUpdates = (payload.resultBriefs ?? []).map(r => ({id:r.id,title:r.titleEn,translationJa:r.titleJa,bodyJa:r.facts.map(f => `${f.ja}：${f.value}`).join("\n"),bodyEn:r.facts.map(f => `${f.en}: ${f.value}`).join("\n"),url:r.url,publisher:r.publisher,tickers:[r.ticker],observedAt:r.observedAt,publishedAt:r.publishedAt,researchId:r.kind === 'earnings' ? r.researchId : undefined}));
    const fallback = issuerEvents.some(e => e.ticker === "MU" && e.kind === "earnings") ? [] : [{...muFlash, bodyJa: muLatest.facts.map(f => f.text.ja).join("\n\n"), bodyEn: muLatest.facts.map(f => f.text.en).join("\n\n")}];
    const merged: OfficialUpdate[] = [...resultUpdates, ...fallback, ...(payload.officialUpdates ?? []).filter(item => item.url !== muFlash.url && !resultUpdates.some(r => r.url === item.url))];
    payload.officialUpdates = mergeResultNews(merged, payload.resultBriefs ?? [])
      .toSorted((a,b)=>Date.parse(b.publishedAt ?? b.observedAt)-Date.parse(a.publishedAt ?? a.observedAt)).slice(0,20);
    return Response.json(availableNewsPayload(payload), { headers });
  } catch {
    // A monitor outage is not an empty, successfully refreshed news feed.
    return Response.json({ ok: false, enabled: false, items: [] }, { status: 503, headers });
  }
}
