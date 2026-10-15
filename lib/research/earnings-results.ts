import type { ResultBrief } from "./market-results";
import type { OfficialUpdate } from "./general-news";

export type EarningsResult = {
  id: string; ticker: string; releasedAt: string; kind: "flash" | "release";
  title: { ja: string; en: string }; result: { ja: string | null; en: string }; sourceUrl: string; sourceName: string;
  /** Verified figures from result flashes, one line each. */
  facts: { ja: string; en: string }[];
  /** The company release's own text, when the monitor read it. */
  body: { ja: string | null; en: string | null };
  /** Every source behind this one result, oldest first. */
  sources: { name: string; url: string }[];
};

/** Companies known by a name other than their ticker on screen (owner, Oct 15: "TSM" next to "TSMC"). */
const DISPLAY_NAME: Record<string, string> = { TSM: "TSMC" };
const displayName = (ticker: string) => DISPLAY_NAME[ticker] ?? ticker;
const withName = <T extends string | null>(text: T, ticker: string): T => (text ? text.replace(new RegExp(`^${ticker}(?=[\\s　Q])`), displayName(ticker)) : text) as T;

/** One earnings event is one row: a release and its flashes (or two copies of
 * the same release) fall within this window of each other. */
const SAME_EVENT_MS = 36 * 3_600_000;

// A results release, not a date notice or call invitation (same rule as the monitor).
const RESULTS = /\b(?:Q[1-4]|first|second|third|fourth|quarter(?:ly)?|fiscal)\b.{0,80}\b(?:results|earnings|EPS|revenue|net sales|net income)\b|\b(?:results|earnings|EPS|revenue|net sales|net income)\b.{0,80}\b(?:Q[1-4]|quarter|fiscal)\b/i;
const NOT_RESULTS = /\b(?:will|to)\s+(?:report|announce|release|host|hold|publish)\b|conference call|webcast|\bdate\b|\bschedule[ds]?\b|\binvit/i;

/** Earnings results releases and the notices around them belong to the calendar
 * and the company pages, not the home news list (owner, Oct 14). */
export function isEarningsRelated(item: OfficialUpdate): boolean {
  return item.tickers.length === 1 && RESULTS.test(item.title);
}

/** Released earnings for the calendar (owner, Oct 11): numeric flashes from
 * source posts and the companies' own results releases, newest first.
 * Oct 14: several postings of one result are merged into a single row. */
export function earningsResults(updates: OfficialUpdate[] = [], briefs: ResultBrief[] = []): EarningsResult[] {
  const rows: EarningsResult[] = [];
  for (const brief of briefs) {
    if (brief.kind !== "earnings") continue;
    rows.push({ id: `flash-${brief.id}`, ticker: brief.ticker, releasedAt: brief.publishedAt, kind: "flash",
      title: { ja: `${displayName(brief.ticker)} 決算速報（${brief.period}）`, en: `${displayName(brief.ticker)} ${brief.period} earnings flash` },
      result: { ja: withName(brief.titleJa, brief.ticker), en: withName(brief.titleEn, brief.ticker) }, sourceUrl: brief.url, sourceName: brief.publisher,
      facts: brief.facts.map(fact => ({ ja: `${fact.ja} ${fact.value}`, en: `${fact.en} ${fact.value}` })),
      body: { ja: null, en: null }, sources: [{ name: brief.publisher, url: brief.url }] });
  }
  for (const item of updates) {
    const ticker = item.tickers[0];
    const at = item.publishedAt ?? item.observedAt;
    if (!ticker || item.tickers.length !== 1 || !RESULTS.test(item.title) || NOT_RESULTS.test(item.title) || !at) continue;
    rows.push({ id: `release-${item.id}`, ticker, releasedAt: at, kind: "release",
      title: { ja: `${displayName(ticker)} 決算発表`, en: `${displayName(ticker)} earnings release` },
      result: { ja: item.translationJa ?? null, en: item.title }, sourceUrl: item.url, sourceName: item.publisher,
      facts: [], body: { ja: item.bodyJa?.trim() || null, en: item.bodyEn?.trim() || null }, sources: [{ name: item.publisher, url: item.url }] });
  }
  rows.sort((a, b) => Date.parse(a.releasedAt) - Date.parse(b.releasedAt));
  const events: EarningsResult[][] = [];
  for (const row of rows) {
    const group = events.find(rowsOfEvent => rowsOfEvent[0].ticker === row.ticker
      && Math.abs(Date.parse(row.releasedAt) - Date.parse(rowsOfEvent[0].releasedAt)) <= SAME_EVENT_MS);
    if (group) group.push(row); else events.push([row]);
  }
  return events.map(group => {
    const release = group.find(row => row.kind === "release" && row.result.ja) ?? group.find(row => row.kind === "release");
    const flash = group.find(row => row.kind === "flash");
    const first = release ?? group[0];
    const seen = new Set<string>();
    return { ...first, kind: release ? "release" as const : "flash" as const,
      // Figures come from the flash; the release supplies the official wording.
      result: flash && !release?.result.ja ? flash.result : release ? { ja: flash?.result.ja ?? release.result.ja, en: flash?.result.en ?? release.result.en } : first.result,
      facts: group.flatMap(row => row.facts).filter(fact => !seen.has(fact.en) && seen.add(fact.en)),
      body: group.find(row => row.body.ja || row.body.en)?.body ?? { ja: null, en: null },
      sources: group.flatMap(row => row.sources).filter((source, index, all) => all.findIndex(other => other.url === source.url) === index) };
  }).sort((a, b) => Date.parse(b.releasedAt) - Date.parse(a.releasedAt));
}
