import "server-only";
import providers from "./providers.json";
import { comparisonDirectory, prewarmComparison, statementsNeeded } from "./comparison-server";
import { cachedStatements, hasSeriesToday, hasStatisticsToday, minuteUsage, providerConfigured, warmSeries, warmStatements, warmStatistics, weeklyNote } from "./twelve-store";
import { COST, WARM_CEILING, hasRoom, profileDue, tickersForMinute, warmUniverse } from "./twelve-warm-plan";

/** One minute of the background job (app/api/research/compare/warm, called once a minute): the companies whose minute it is get today's
 * statistics and price series, and, when their filing cannot give every figure, the provider's statements about once a week. Every call is sent
 * only while the minute's usage stays under WARM_CEILING; a skipped company keeps yesterday's entry and is tried again tomorrow. */

const need = weeklyNote("comparison-store-statement-need-v1", statementsNeeded);
const STATEMENTS_MAX_AGE = 6.5 * 86_400_000;

/** `filings`: companies whose SEC figures were read into the comparison cache this minute (no provider credits). */
export type WarmReport = { minute: string; tickers: string[]; spent: number; skipped: string[]; usedAtStart: number | null; filings?: number };

export async function warmMinute(now = Date.now()): Promise<WarmReport> {
  const report: WarmReport = { minute: new Date(now).toISOString().slice(0, 16), tickers: [], spent: 0, skipped: [], usedAtStart: null };
  if (!providerConfigured()) return report;
  const universe = warmUniverse(await comparisonDirectory(), providers.map(p => p.ticker));
  const due = tickersForMinute(universe, now);
  report.tickers = due.map(d => d.ticker);
  let used = report.usedAtStart = await minuteUsage(0);
  const spend = async (ticker: string, kind: string, cost: number, run: () => Promise<unknown>) => {
    if (!hasRoom(used, cost, WARM_CEILING)) { report.skipped.push(`${ticker}:${kind}`); return; }
    used! += cost; report.spent += cost;
    await run();
  };
  // The SEC figures of this minute's companies are read into the comparison cache beside the provider calls (free; speed, owner Nov 18: a
  // user's first comparison of the day no longer waits for the SEC). A failure only leaves that company to be read on demand.
  const filings = Promise.all(due.map(({ ticker }) => prewarmComparison(ticker).catch(() => false)));
  // Statistics and series first, for all of this minute's companies at once (5 companies, 255 credits).
  await Promise.all(due.map(async ({ ticker }) => {
    if (!await hasStatisticsToday(ticker, now)) await spend(ticker, "statistics", COST.statistics, () => warmStatistics(ticker, now));
    if (!await hasSeriesToday(ticker, now)) await spend(ticker, "series", COST.series, () => warmSeries(ticker, now));
  }));
  // Then, one company at a time, the statements where the filing falls short (200 credits; the meter is read again first).
  for (const { ticker, index } of due) {
    let note = await need.read(ticker, now);
    if (!note || profileDue(index, now)) note = await need.write(ticker, now) ?? note;
    if (!note?.needs) continue;
    const stored = await cachedStatements(ticker, now);
    if (stored && now - Date.parse(stored.retrievedAt) < STATEMENTS_MAX_AGE) continue;
    used = Math.max(used ?? 0, await minuteUsage(0) ?? Infinity);
    await spend(ticker, "statements", COST.statements, () => warmStatements(ticker, now));
  }
  report.filings = (await filings).filter(Boolean).length;
  return report;
}
