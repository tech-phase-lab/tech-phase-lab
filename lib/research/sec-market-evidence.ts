import type { Financials } from "./comparison.ts";
import { normalizeTwelveFactors, type TwelveFactorEvidence } from "./twelve-data-factors.ts";
import type { TwelveComparisonSnapshot } from "./twelve-data-comparison.ts";
import { twelveNumber } from "./twelve-data-values.ts";

type Raw = { payload: unknown; retrievedAt: string };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** The price-dependent and cross-quarter factors for a company whose financials come from the SEC (the same evidence shape the scorecard
 * already reads, so the radar, bars and copy need no new path).
 *  - stability: the last four quarters' operating margins from the SEC filings (no provider needed);
 *  - momentum: the live split-adjusted daily series (one credit), checked by the same rules as before;
 *  - valuation: the provider's forward P/E only (an estimate that belongs to the price and consensus, not to a statement quarter, so it needs
 *    no quarter match; it must still be this symbol, in this currency, and timestamped). Balance-sheet items come from the SEC balance, never
 *    from the provider's statistics, which may describe an older quarter.
 * Anything that cannot be verified is left out; nothing is invented. */
export function buildSecMarketEvidence(c: Financials, series?: Raw & { adjust: "splits" }, statistics?: Raw, now = Date.now()): TwelveFactorEvidence | null {
  const q = c.quarterRevenue;
  if (c.status !== "ready" || !q || !/^[A-Z]{3}$/.test(q.unit)) return null;
  const stub = { ticker: c.ticker, currency: q.unit, periodEnd: q.end, retrievedAt: c.retrievedAt } as TwelveComparisonSnapshot;
  const base = normalizeTwelveFactors(stub, null, undefined, series, now);
  let forwardPE: number | null = null, priceToSales: number | null = null;
  if (statistics) {
    const root = obj(statistics.payload), meta = obj(root.meta), valuations = obj(obj(root.statistics).valuations_metrics);
    const at = Date.parse(statistics.retrievedAt);
    const pe = twelveNumber(valuations.forward_pe);
    const usable = root.status !== "error" && meta.symbol === c.ticker && meta.currency === q.unit && Number.isFinite(at) && at <= now;
    if (usable && pe !== null && pe > 0) forwardPE = pe;
    // Price-to-sales: the provider's current market value over the SEC's own last four quarters (the provider's figure may stop a quarter earlier).
    const cap = twelveNumber(valuations.market_capitalization);
    if (usable && cap !== null && cap > 0 && c.quarterRevenueTtm && c.quarterRevenueTtm > 0) priceToSales = cap / c.quarterRevenueTtm;
  }
  return {
    ...base,
    margins: c.quarterMargins ?? [],
    statistics: (forwardPE !== null || priceToSales !== null) && statistics
      ? { retrievedAt: statistics.retrievedAt, quarterEnd: q.end, forwardPE, trailingPE: null, currentRatio: null, totalCash: null, totalDebt: null, priceToSales }
      : null,
  };
}
