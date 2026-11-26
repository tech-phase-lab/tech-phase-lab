import "server-only";
import { buildPublicNews } from "./public-news-response";
import { freeTechSelection, projectFreeNews } from "./tech-news-access";
import { readMonitor } from "./tech-news-server";
import { historyRange } from "./earnings-results-history";
import { loadEarningsHistory } from "./earnings-history-server";
import type { GeneralNewsFeed } from "./general-news";
import type { ResultBrief } from "./market-results";

/** What the calendar draws into its first HTML (speed, Nov 26; Nov 26 production: rows appeared after 7.3 s and moved the page, CLS 0.39):
 * the posted results (which decide which upcoming rows are already done) and the minute the page was drawn. Read from the monitor only.
 * The calendar and its results are FREE (policy of Oct 25), and the news feed's FREE projection keeps every result and every economic
 * release whole (lib/research/tech-news-access.ts), so this is what /api/research/news gives any reader for these rows: the same HTML for
 * everyone, no member data. */
export type FirstCalendar = {
  now: number;
  news: Pick<GeneralNewsFeed, "ok" | "enabled" | "items" | "officialUpdates" | "resultBriefs" | "eventResults">;
  history: { month: "recent"; resultBriefs: ResultBrief[]; months: string[] } | null;
};

async function load(): Promise<FirstCalendar> {
  const range = historyRange("recent");
  const [raw, history] = await Promise.all([readMonitor("news", 500_000, 5_000), range ? loadEarningsHistory(range, 1_500).catch(() => null) : null]);
  const now = Date.now();
  const feed = buildPublicNews(raw);
  const free = projectFreeNews(feed, freeTechSelection(feed, {}, now));
  // Only what the results rows read; no story items are sent.
  return { now: Math.floor(now / 60_000) * 60_000, news: { ok: true, enabled: free.enabled, items: [], officialUpdates: free.officialUpdates ?? [], resultBriefs: free.resultBriefs ?? [], eventResults: free.eventResults ?? [] },
    history: history && { month: "recent", resultBriefs: history.resultBriefs, months: history.months } };
}

export function firstCalendarWithin(wait = 1_500): Promise<FirstCalendar | null> {
  return Promise.race([load().catch(() => null), new Promise<null>(resolve => setTimeout(() => resolve(null), wait))]);
}
