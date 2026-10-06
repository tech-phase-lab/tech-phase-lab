import { availableNewsPayload, publicNewsPayload, boundedOfficialHistory, OFFICIAL_NEWS_HISTORY_LIMIT, type OfficialUpdate } from "./general-news.ts";
import { officialResultEvents } from "./official-result-events.ts";
import { mergeResultNews, resultNewsUpdate } from "./result-news.ts";
import { muFlash, muLatest } from './mu-latest.ts';

/** Build the same sanitized public feed for HTML and subsequent API refreshes. */
export function buildPublicNews(value: unknown, { allowOriginalPreview = false }: { allowOriginalPreview?: boolean } = {}) {
    const raw = value as Record<string, unknown>;
    // This is public preview content, not owner/member diagnostics. Never trust an
    // upstream marker to enable it in production or unspecified environments.
    const payload = availableNewsPayload({ ...raw,
      originalPreviewItems: allowOriginalPreview ? raw?.originalPreviewItems : undefined,
      originalPreviewWindow: allowOriginalPreview ? raw?.originalPreviewWindow : undefined });
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
        ? { shortTitleJa: undefined, shortTitleEn: undefined, pulseTitleJa: undefined, pulseTitleEn: undefined, title: event.title.en, translationJa: event.title.ja }
        : {};
      const enriched = { ...item, ...titles, researchId: event.id, bodyJa: [...new Set([event.summary.ja, ...event.facts.map(f => f.text.ja)])].join("\n\n"), bodyEn: [...new Set([event.summary.en, ...event.facts.map(f => f.text.en)])].join("\n\n") };
      try {
        return publicNewsPayload({ ok: true, enabled: payload.enabled, items: [], resultBriefs: payload.resultBriefs, officialUpdates: [enriched] }).officialUpdates![0];
      } catch {
        return item;
      }
    });
    const resultUpdates = (payload.resultBriefs ?? []).map(resultNewsUpdate);
    const fallback = issuerEvents.some(e => e.ticker === "MU" && e.kind === "earnings") ? [] : [{...muFlash, bodyJa: muLatest.facts.map(f => f.text.ja).join("\n\n"), bodyEn: muLatest.facts.map(f => f.text.en).join("\n\n")}];
    const merged: OfficialUpdate[] = [...resultUpdates, ...fallback, ...(payload.officialUpdates ?? []).filter(item => item.url !== muFlash.url && !resultUpdates.some(r => r.url === item.url))];
    const history = mergeResultNews(merged, payload.resultBriefs ?? [])
      // Apply the same source-clock precedence as the list/pulse before the
      // limit; a newly acquired older date-only article must not crowd them out.
      .toSorted((a,b)=>Date.parse(b.publishedAt ?? b.publishedOn ?? b.observedAt)-Date.parse(a.publishedAt ?? a.publishedOn ?? a.observedAt));
    payload.officialUpdates = history.slice(0, OFFICIAL_NEWS_HISTORY_LIMIT);
    if (payload.officialHistory) {
      const omitted = Math.max(0, history.length - OFFICIAL_NEWS_HISTORY_LIMIT);
      payload.officialHistory = { ...payload.officialHistory, returned: payload.officialUpdates.length,
        omitted: payload.officialHistory.omitted + omitted,
        hasMore: payload.officialHistory.hasMore || omitted > 0 };
    }
    return boundedOfficialHistory(availableNewsPayload(payload));
}
