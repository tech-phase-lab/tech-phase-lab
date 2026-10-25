import type { GeneralNewsFeed } from './general-news.ts';
import type { CompanyWireItem } from './company-wire.ts';
import type { TechHeadline } from './tech-headlines.ts';
import { flashRows, flashInstant, WATCH_TICKERS } from './flash-rows.ts';
import { earningsResults } from './earnings-results.ts';

export const FREE_TECH_DELAY_MS = 30 * 60_000;

/** Apply only after normal source validation, before any HTML/API serialization. */
export function projectTechNews(feed: GeneralNewsFeed, wire: Record<string, CompanyWireItem[]>, pro: boolean, now = Date.now()): GeneralNewsFeed {
  if (pro) return { ...feed, techAccess: 'pro', techHeadlines: [] };
  const watched = (tickers: string[]) => tickers.some(t => WATCH_TICKERS.has(t));
  const ja = new Map(flashRows(feed, wire, 'ja').map(row => [row.id, row]));
  const seenSources = new Set<string>();
  const candidates = flashRows(feed, wire, 'en').filter(row => row.kind === 'news').flatMap(row => {
    const published = flashInstant(row);
    // A date has no known release clock. Wait from first observation instead.
    const release = row.timeKind === 'date' ? Date.parse(row.observedAt ?? '') : published;
    if (!Number.isFinite(release) || !Number.isFinite(now) || release > now - FREE_TECH_DELAY_MS) return [];
    let titleEn = row.title, titleJa = ja.get(row.id)?.title;
    let sourceKey = row.url ?? row.id;
    if (row.id.startsWith('official:')) {
      const source = feed.officialUpdates?.find(item => `official:${item.id}` === row.id);
      if (!source) return [];
      titleEn = source.title; titleJa = source.translationJa; sourceKey = source.url;
    } else if (row.id.startsWith('news:')) {
      const source = feed.items.find(item => `news:${item.id}` === row.id);
      if (!source) return [];
      // Never promote a summary to a FREE headline, even when no JA title exists.
      titleEn = source.title; titleJa = source.shortTitleJa; sourceKey = source.url;
    }
    if (seenSources.has(sourceKey)) return [];
    seenSources.add(sourceKey);
    const headline: TechHeadline = { id: row.id, tickers: [...row.tickers], titleEn,
      ...(titleJa ? { titleJa } : {}), at: row.at, timeKind: row.timeKind };
    return [headline];
  }).slice(0, 5);
  const resultUrls = new Set(earningsResults(feed.officialUpdates, feed.resultBriefs).flatMap(row => row.sources.map(s => s.url)));
  // Start with an explicit whitelist. Unknown future fields cannot leak paid text.
  return {
    ok: true, enabled: feed.enabled, techAccess: 'free', techHeadlines: candidates,
    items: feed.items.filter(item => !watched(item.tickers)),
    officialUpdates: (feed.officialUpdates ?? []).filter(item => !watched(item.tickers) || resultUrls.has(item.url)),
    analystUpdates: (feed.analystUpdates ?? []).filter(item => !WATCH_TICKERS.has(item.ticker)),
    marketUpdates: feed.marketUpdates, resultBriefs: feed.resultBriefs,
    // Original-preview excerpts and history counts are not a public bypass.
  };
}
