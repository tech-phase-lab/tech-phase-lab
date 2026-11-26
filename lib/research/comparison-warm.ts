import "server-only";
import providers from "./providers.json";
import { comparisonDirectory, pendingRelease, prewarmComparison, statementsNeeded } from "./comparison-server";
import { RELEASE_ATTEMPTS, cachedStatements, hasSeriesToday, hasStatisticsToday, minuteUsage, providerConfigured, releaseStatements, warmReleaseStatements, warmSeries, warmStatements, warmStatistics, weeklyNote } from "./twelve-store";
import { COST, WARM_CEILING, hasRoom, profileDue, retryTickers, statementOrder, tickersForMinute, warmUniverse } from "./twelve-warm-plan";

/** One minute of the background job (app/api/research/compare/warm, called once a minute): the companies whose minute it is get today's
 * statistics and price series, and, when their filing cannot give every figure, the provider's statements about once a week. Every call is sent
 * only while the minute's usage stays under WARM_CEILING; a skipped company keeps yesterday's entry and is tried again tomorrow. */

const need = weeklyNote("comparison-store-statement-need-v1", statementsNeeded);
const STATEMENTS_MAX_AGE = 6.5 * 86_400_000;

/** `filings`: companies whose SEC figures were read into the comparison cache this minute (no provider credits). */
export type WarmReport = { minute: string; tickers: string[]; spent: number; skipped: string[]; usedAtStart: number | null; filings?: number };

/** `alreadySpent`: credits this minute's request has just asked for elsewhere (the レバETF snapshot, read first): counted as used even if the
 * provider's meter has not seen them yet, so the comparison yields that much of its room. */
export async function warmMinute(now = Date.now(), alreadySpent = 0): Promise<WarmReport> {
  const report: WarmReport = { minute: new Date(now).toISOString().slice(0, 16), tickers: [], spent: 0, skipped: [], usedAtStart: null };
  if (!providerConfigured()) return report;
  const universe = warmUniverse(await comparisonDirectory(), providers.map(p => p.ticker));
  const due = tickersForMinute(universe, now);
  report.tickers = due.map(d => d.ticker);
  let used = report.usedAtStart = await minuteUsage(0);
  if (used !== null) used += alreadySpent;
  const spend = async (ticker: string, kind: string, cost: number, run: () => Promise<unknown>) => {
    if (!hasRoom(used, cost, WARM_CEILING)) { report.skipped.push(`${ticker}:${kind}`); return; }
    used! += cost; report.spent += cost;
    await run();
  };
  // The SEC figures of this minute's companies are read into the comparison cache beside the provider calls (free; speed, owner Nov 18: a
  // user's first comparison of the day no longer waits for the SEC). A failure only leaves that company to be read on demand.
  const filings = Promise.all(due.map(({ ticker }) => prewarmComparison(ticker).catch(() => false)));
  // A newer earnings release without its quarterly report (NVDA, Nov 26): the statements are read again after the release, in the company's
  // own minute, at most RELEASE_ATTEMPTS times per release (releaseAttempt), so the cost follows releases, never users.
  const releases = filings.then(() => Promise.all(due.map(({ ticker }) => pendingRelease(ticker, now).catch(() => null))));
  // Companies of the last few minutes whose refresh was skipped (a full minute) go first, then this minute's (statistics and series). The
  // retries only use room beyond what this minute's own companies need, so a retry never pushes today's companies out in turn.
  const refresh = async ({ ticker }: { ticker: string }) => {
    if (!await hasStatisticsToday(ticker, now)) await spend(ticker, "statistics", COST.statistics, () => warmStatistics(ticker, now));
    if (!await hasSeriesToday(ticker, now)) await spend(ticker, "series", COST.series, () => warmSeries(ticker, now));
  };
  const own = new Set(due.map(d => d.ticker)), ownNeed = due.length * (COST.statistics + COST.series);
  for (const retry of retryTickers(universe, now).filter(r => !own.has(r.ticker))) {
    if (!hasRoom(used, COST.statistics + COST.series + ownNeed, WARM_CEILING)) break;
    await refresh(retry);
  }
  await Promise.all(due.map(refresh));
  // Then, one company at a time, the statements where the filing falls short (200 credits; the meter is read again first).
  for (const { ticker, index } of statementOrder(due, now)) {
    let note = await need.read(ticker, now);
    if (!note || profileDue(index, now)) note = await need.write(ticker, now) ?? note;
    if (!note?.needs) continue;
    const stored = await cachedStatements(ticker, now);
    if (stored && now - Date.parse(stored.retrievedAt) < STATEMENTS_MAX_AGE) continue;
    used = Math.max(used ?? 0, await minuteUsage(0) ?? Infinity);
    await spend(ticker, "statements", COST.statements, () => warmStatements(ticker, now));
  }
  const pending = await releases;
  for (const [i, { ticker }] of due.entries()) {
    const release = pending[i];
    if (!release) continue;
    const stored = await releaseStatements(ticker, release.day);
    const attempt = releaseAttempt(release, stored ? { attempt: stored.attempt, retrievedAt: stored.retrievedAt, newest: newestQuarter(stored.income) } : null, now);
    if (attempt === null) continue;
    used = Math.max(used ?? 0, await minuteUsage(0) ?? Infinity);
    await spend(ticker, "statements-release", COST.statements, () => warmReleaseStatements(ticker, release.day, attempt));
  }
  report.filings = (await filings).filter(Boolean).length;
  return report;
}

/** Which read of the statements after a release is due now, or null: the first a day after the release (the provider adds a quarter within
 *  a day or two), a second only if the first still lacked the newer quarter and at least three days have passed; none a month after the
 *  release (the quarterly report is filed by then). At most RELEASE_ATTEMPTS per company and release. */
export function releaseAttempt(release: { day: string; filedEnd: string }, stored: { attempt: number; retrievedAt: string; newest: string | null } | null, now: number): number | null {
  const since = now - Date.parse(release.day);
  if (!(since >= 86_400_000) || since > 30 * 86_400_000) return null;
  if (!stored) return 0;
  const hasNewer = !!stored.newest && Date.parse(stored.newest) > Date.parse(release.filedEnd) + 10 * 86_400_000;
  const next = stored.attempt + 1;
  return !hasNewer && next < RELEASE_ATTEMPTS && since >= 4 * 86_400_000 && now - Date.parse(stored.retrievedAt) >= 3 * 86_400_000 ? next : null;
}
/** The newest quarter end in the provider's income statement, or null. */
export function newestQuarter(income: unknown): string | null {
  const rows = (income as { income_statement?: unknown } | null)?.income_statement;
  if (!Array.isArray(rows)) return null;
  const ends = rows.map(r => (r as { fiscal_date?: unknown })?.fiscal_date).filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d));
  return ends.sort().at(-1) ?? null;
}
