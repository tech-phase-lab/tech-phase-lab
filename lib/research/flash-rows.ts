import type { Language } from "./data";
import type { GeneralNewsFeed } from "./general-news.ts";
import type { CompanyWireItem } from "./company-wire.ts";
import { earningsOnlyProviders, providers } from "./intake.ts";
import { earningsResults, isEarningsRelated } from "./earnings-results.ts";
import { analystNewsDisplay } from "./analyst-news.ts";
import { officialNewsDisplay, shownInLanguage, socialChatter } from "./news-presentation.ts";
import { NEWS_MAX_AGE_MS, officialTime } from "./news-time.ts";
import { wireStories } from "./wire-stories.ts";

/** The 速報 page: one newest-first timeline of what each watched company's
 * live monitor shows (the 22 stocks) and earnings results (those 22 plus the
 * 15 earnings-only stocks). SEC filings are not listed here yet (owner, Oct 14). */
export const WATCH_TICKERS: ReadonlySet<string> = new Set(providers.map(p => p.ticker));
export const FLASH_TICKERS: readonly string[] = [...WATCH_TICKERS, ...earningsOnlyProviders.map(p => p.ticker)].sort();
const ROSTER: ReadonlySet<string> = new Set(FLASH_TICKERS);

export type FlashKind = "news" | "earnings";
export type FlashRow = {
  id: string; kind: FlashKind; tickers: string[]; title: string; body?: string; url?: string; source?: string;
  /** Publication instant, or a date for a source that states only the day. */
  at: string; timeKind: "published" | "date"; observedAt?: string;
};

/** Sort key: a date-only row sits at the start of its day. */
export const flashInstant = (row: Pick<FlashRow, "at" | "timeKind">) => Date.parse(row.timeKind === "date" ? `${row.at}T00:00:00Z` : row.at);

export function flashRows(feed: Partial<GeneralNewsFeed> | null | undefined, wire: Record<string, CompanyWireItem[]>, lang: Language): FlashRow[] {
  const ja = lang === "ja";
  const rows: FlashRow[] = [];
  const watched = (tickers: string[]) => tickers.filter(ticker => WATCH_TICKERS.has(ticker));
  const official = Array.isArray(feed?.officialUpdates) ? feed.officialUpdates : [];
  const briefs = Array.isArray(feed?.resultBriefs) ? feed.resultBriefs : [];
  for (const item of official) {
    try {
      const tickers = watched(item.tickers);
      const time = officialTime(item);
      // Earnings releases belong to the earnings rows below; a story with no
      // source time is never listed (owner, Oct 10).
      if (!tickers.length || isEarningsRelated(item) || socialChatter(item) || time.kind === "observed" || !shownInLanguage(item, lang)) continue;
      const display = officialNewsDisplay(item, lang, briefs);
      rows.push({ id: `official:${item.id}`, kind: "news", tickers, title: display.title, body: display.body ?? undefined, at: time.at,
        timeKind: time.kind === "date" ? "date" : "published", observedAt: item.observedAt, source: item.publisher });
    } catch { /* One malformed row never hides the others. */ }
  }
  for (const item of Array.isArray(feed?.analystUpdates) ? feed.analystUpdates : []) {
    if (!WATCH_TICKERS.has(item.ticker)) continue;
    const display = analystNewsDisplay(item, lang);
    rows.push({ id: `analyst:${item.id}`, kind: "news", tickers: [item.ticker], title: display.title, body: display.body ?? undefined, at: item.publishedAt, timeKind: "published", observedAt: item.observedAt });
  }
  for (const item of Array.isArray(feed?.items) ? feed.items : []) {
    const tickers = watched(item.tickers);
    const title = ja ? item.summaryJa : item.summaryEn;
    if (tickers.length && title) rows.push({ id: `news:${item.id}`, kind: "news", tickers, title, body: ja ? item.impactJa : item.impactEn, at: item.publishedAt, timeKind: "published", observedAt: item.observedAt });
  }
  // One story is one row, naming every watched company it concerns (owner, Oct 17).
  for (const story of wireStories(wire, lang, WATCH_TICKERS)) {
    rows.push({ id: `wire:${story.id}`, kind: "news", tickers: story.tickers, title: story.title, url: story.url, source: story.publisher, at: story.at, timeKind: "published" });
  }
  for (const row of earningsResults(official, briefs)) {
    const result = ja ? row.result.ja : row.result.en;
    if (!ROSTER.has(row.ticker) || (ja && !row.result.ja)) continue;
    rows.push({ id: `earnings:${row.id}`, kind: "earnings", tickers: [row.ticker], title: result ? `${row.title[lang]}｜${result}` : row.title[lang],
      body: [...row.facts.map(fact => ja ? fact.ja : fact.en), (ja ? row.body.ja : row.body.en) ?? ""].filter(Boolean).join("\n") || undefined,
      at: row.releasedAt, timeKind: "published", source: row.sourceName });
  }
  return rows.sort((a, b) => flashInstant(b) - flashInstant(a) || a.id.localeCompare(b.id));
}

/** What raises the NEW dot on 速報: rows with a stated publication time, within three days. */
export function flashAlerts(feed: Partial<GeneralNewsFeed> | null | undefined, wire: Record<string, CompanyWireItem[]>, now = Date.now()) {
  return flashRows(feed, wire, "ja").filter(row => row.timeKind === "published").map(row => ({ id: row.id, title: row.title, at: Date.parse(row.at) }))
    .filter(item => Number.isFinite(item.at) && item.at <= now + 60_000 && now - item.at < NEWS_MAX_AGE_MS);
}
