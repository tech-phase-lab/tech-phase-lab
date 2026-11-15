import "server-only";
import providers from "./providers.json";
import { comparisonDirectory, statementsNeeded } from "./comparison-server";
import { cachedStatements, hasSeriesToday, hasStatisticsToday, minuteUsage, providerConfigured, warmSeries, warmStatements, warmStatistics, weeklyNote } from "./twelve-store";
import { COST, WARM_CEILING, hasRoom, profileDue, tickersForMinute, warmUniverse } from "./twelve-warm-plan";

/** One minute of the background job (app/api/research/compare/warm, called once a minute): the companies whose minute it is get today's
 * statistics and price series, and, when their filing cannot give every figure, the provider's statements about once a week. Every call is sent
 * only while the minute's usage stays under WARM_CEILING; a skipped company keeps yesterday's entry and is tried again tomorrow. */

const need = weeklyNote("comparison-store-statement-need-v1", statementsNeeded);
const STATEMENTS_MAX_AGE = 6.5 * 86_400_000;

export type WarmReport = { minute: string; tickers: string[]; spent: number; skipped: string[]; usedAtStart: number | null };

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
  return report;
}
