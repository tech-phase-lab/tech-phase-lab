import "server-only";
import { prepareTwelveComparisonForDisplay } from "./twelve-data-comparison-server";
import type { TwelveComparisonBundle } from "./twelve-data-financials";
import { freshEnough } from "./fresh-enough";
import { cachedStatements, cachedStatistics, providerConfigured, userSeries, type Statements } from "./twelve-store";
export { freshEnough };

/** The provider's side of the comparison screen, for a user's request (Nov 15 redesign). The key stays in TWELVE_DATA_API_KEY.
 * Nothing here calls the expensive endpoints: statistics (50 credits) and the statements (100 + 100) come only from the shared store that the
 * background job fills (lib/research/twelve-store.ts, app/api/research/compare/warm), the price series included (owner, Nov 26: a request
 * never calls the provider). A request therefore never waits for credits, and its cost does not grow with users. */
export const twelveComparisonConfigured = providerConfigured;

export type Raw = { payload: unknown; retrievedAt: string };

/** The stored statements with today's statistics and price series, prepared for display; null when the statements are not stored yet.
 * `stored`: statements read after a newer earnings release (twelve-store releaseStatements) in place of the weekly copy. */
export async function loadTwelveComparison(ticker: string, stored?: Statements | null) {
  if (!twelveComparisonConfigured()) return null;
  const statements = stored ?? await cachedStatements(ticker);
  if (!statements) return null;
  const [statistics, series] = await Promise.all([cachedStatistics(ticker), userSeries(ticker)]);
  const bundle: TwelveComparisonBundle = { ticker, retrievedAt: statements.retrievedAt, income: statements.income, cashFlow: statements.cashFlow,
    ...(statistics ? { statistics } : {}), ...(series ? { series } : {}) };
  try { return await prepareTwelveComparisonForDisplay(bundle); }
  catch (error) { console.warn(`twelve-data comparison ${ticker}: ${error instanceof Error ? error.message : "failed"}`); return null; }
}

/** The provider's price-dependent inputs for a company whose financials come from the SEC: the stored statistics (forward P/E) and the price
 * series. Either may be missing; the matching factor then falls back (price-to-sales from the filing) or is left out, nothing is invented. */
export async function loadMarketInputs(ticker: string): Promise<{ series?: Raw & { adjust: "splits" }; statistics?: Raw }> {
  if (!twelveComparisonConfigured()) return {};
  const [series, statistics] = await Promise.all([userSeries(ticker), cachedStatistics(ticker)]);
  return { ...(series ? { series } : {}), ...(statistics ? { statistics } : {}) };
}

/** Kept for the comparison server: `busy` is never set any more (nothing waits for credits); a missing entry is filled in the background. */
export async function loadTwelveComparisonState(ticker: string, stored?: Statements | null): Promise<{ data: Awaited<ReturnType<typeof loadTwelveComparison>>; busy: boolean }> {
  return { data: await loadTwelveComparison(ticker, stored), busy: false };
}
