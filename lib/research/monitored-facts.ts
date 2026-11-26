import registry from "./providers.json" with { type: "json" };

/** 監視22銘柄's quote cards: EPS, market cap, dividend yield and the next earnings date, kept by the site's minute job.
 * No server-only / Next imports so it can be tested directly; the wiring is lib/research/market-data.ts (refreshMonitoredFacts).
 *
 * Production, Nov 26: ARM, TSM, ASML, ANET, CRDO, CRWV, GEV and PLTR showed — for all three figures (`complete: false`). Twelve Data has every
 * figure for them; the cards never got them. The comparison's daily statistics copy of a company was gone a few hours after the job stored
 * it (ASML stored at 00:21 UTC, missing at 07:52), so each card fell back to a 50-credit statistics and a 20-credit earnings read on the
 * member's request. 22 cards opened at once ask for up to 1,540 credits under the member tier's 480: the first few were granted, the rest
 * refused on every visit and every one-minute retry, and each refusal raised the allocator's member reserve to the whole member tier for
 * five minutes, which refused the comparison's own warm reads too (allocator log, 07:53–07:56: warm:compare-statistics refused 200 a minute).
 * Now the minute job reads these cards' facts on the warm tier, a few credits a minute at most, and a member's request reads the copies. */
export const MONITORED_FACTS_TICKERS: readonly string[] = (registry as { ticker: string; scope?: string }[])
  .filter(p => p.scope !== "earnings").map(p => p.ticker);
const MONITORED = new Set(MONITORED_FACTS_TICKERS);
/** True for a ticker whose facts the minute job keeps (a member's request never calls the provider for it). */
export const isMonitoredFactsTicker = (ticker: string) => MONITORED.has(ticker);

/** Statistics reads (50 credits each, or none when the comparison's copy is stored) and earnings reads (20) one minute may send. 22 companies
 * a six-hour slot is about 4 credits a minute on average; a whole roster without copies is filled in 22 minutes, missing ones first. */
export const MONITORED_STATS_PER_MINUTE = 1;
export const MONITORED_EARNINGS_PER_MINUTE = 1;

/** A stored copy: its time and whether it is the current slot's. null: no copy at all. */
export type CopyState = { at: number; fresh: boolean } | null;
/** The tickers to read this minute: those without a current copy, never-read ones first (in roster order), then the oldest copies. */
export function factsDue(states: readonly (readonly [string, CopyState])[], limit: number, skip: (ticker: string) => boolean = () => false): string[] {
  return states.filter(([ticker, state]) => !state?.fresh && !skip(ticker))
    .map(([ticker, state], index) => ({ ticker, at: state ? state.at : -Infinity, index }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .slice(0, Math.max(0, limit)).map(item => item.ticker);
}
