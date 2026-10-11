import type { ResultBrief } from "./market-results";
import type { OfficialUpdate } from "./general-news";

export type EarningsResult = {
  id: string; ticker: string; releasedAt: string; kind: "flash" | "release";
  title: { ja: string; en: string }; result: { ja: string | null; en: string }; sourceUrl: string; sourceName: string;
};

// A results release, not a date notice or call invitation (same rule as the monitor).
const RESULTS = /\b(?:Q[1-4]|first|second|third|fourth|quarter(?:ly)?|fiscal)\b.{0,80}\b(?:results|earnings|EPS|revenue|net sales|net income)\b|\b(?:results|earnings|EPS|revenue|net sales|net income)\b.{0,80}\b(?:Q[1-4]|quarter|fiscal)\b/i;
const NOT_RESULTS = /\b(?:will|to)\s+(?:report|announce|release|host|hold|publish)\b|conference call|webcast|\bdate\b|\bschedule[ds]?\b|\binvit/i;

/** Released earnings for the calendar (owner, Oct 11): numeric flashes from
 * source posts and the companies' own results releases, newest first. */
export function earningsResults(updates: OfficialUpdate[] = [], briefs: ResultBrief[] = []): EarningsResult[] {
  const rows: EarningsResult[] = [];
  for (const brief of briefs) {
    if (brief.kind !== "earnings") continue;
    rows.push({ id: `flash-${brief.id}`, ticker: brief.ticker, releasedAt: brief.publishedAt, kind: "flash",
      title: { ja: `${brief.ticker} 決算速報（${brief.period}）`, en: `${brief.ticker} ${brief.period} earnings flash` },
      result: { ja: brief.titleJa, en: brief.titleEn }, sourceUrl: brief.url, sourceName: brief.publisher });
  }
  for (const item of updates) {
    const ticker = item.tickers[0];
    const at = item.publishedAt ?? item.observedAt;
    if (!ticker || item.tickers.length !== 1 || !RESULTS.test(item.title) || NOT_RESULTS.test(item.title) || !at) continue;
    rows.push({ id: `release-${item.id}`, ticker, releasedAt: at, kind: "release",
      title: { ja: `${ticker} 決算発表`, en: `${ticker} earnings release` },
      result: { ja: item.translationJa ?? null, en: item.title }, sourceUrl: item.url, sourceName: item.publisher });
  }
  return rows.sort((a, b) => Date.parse(b.releasedAt) - Date.parse(a.releasedAt));
}
