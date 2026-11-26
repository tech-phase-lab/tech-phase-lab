import type { Financials } from "./comparison.ts";
import { normalizeTwelveFactors, type TwelveFactorEvidence } from "./twelve-data-factors.ts";
import type { TwelveComparisonSnapshot } from "./twelve-data-comparison.ts";
import { twelveNumber } from "./twelve-data-values.ts";
import { providerSymbol, sameProviderSymbol } from "./provider-symbol.ts";

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
  if (c.status !== "ready" || !q || !/^[A-Z]{3}$/.test(q.unit)) return momentumOnly(c, series, now);
  const stub = { ticker: c.ticker, currency: q.unit, periodEnd: q.end, retrievedAt: c.retrievedAt } as TwelveComparisonSnapshot;
  const base = { ...normalizeTwelveFactors(stub, null, undefined, series, now), ...(c.periodMonths ? { periodMonths: c.periodMonths } : {}) };
  let forwardPE: number | null = null, priceToSales: number | null = null, totalDebt: number | null = null;
  if (statistics) {
    const root = obj(statistics.payload), meta = obj(root.meta), valuations = obj(obj(root.statistics).valuations_metrics);
    const at = Date.parse(statistics.retrievedAt);
    const pe = twelveNumber(valuations.forward_pe);
    const own = root.status !== "error" && sameProviderSymbol(meta.symbol, c.ticker) && Number.isFinite(at) && at <= now;
    const usable = own && meta.currency === q.unit;
    // Forward P/E is a ratio of the listed price to its own earnings estimate, so it holds for a listing quoted in another currency than the
    // filing (BTI's US dollar ADR beside its sterling report). Market value and debt are amounts: they still need the filing's currency.
    if (own && pe !== null && pe > 0) forwardPE = pe;
    // Price-to-sales: the provider's current market value over the SEC's own last four quarters (the provider's figure may stop a quarter earlier).
    const cap = twelveNumber(valuations.market_capitalization);
    if (usable && cap !== null && cap > 0 && c.quarterRevenueTtm && c.quarterRevenueTtm > 0) priceToSales = cap / c.quarterRevenueTtm;
    // The provider's total debt, only for the very quarter of the filing, for a company whose debt is tagged in its own way (ORCL).
    const financials = obj(obj(root.statistics).financials), debt = twelveNumber(obj(financials.balance_sheet).total_debt_mrq);
    if (usable && financials.most_recent_quarter === q.end && debt !== null && debt >= 0) totalDebt = debt;
  }
  let stamp = forwardPE !== null || priceToSales !== null || totalDebt !== null ? statistics?.retrievedAt ?? null : null;
  // No usable cached statistics (they are refreshed in the background, never on a user's request): price-to-sales from the filing itself,
  // the last daily close times the quarter's diluted weighted-average shares over the same four quarters' revenue. US GAAP filers only (a
  // foreign filer's shares are ordinary shares, not the listed ADS), and only in the series' own currency. Not for one share class of several
  // (BRK-B): the diluted count spans every class, whose prices differ (one BRK-A is worth 1,500 BRK-B).
  if (priceToSales === null && series && q.basis === "us-gaap" && providerSymbol(c.ticker) === c.ticker && c.quarterDilutedShares && c.quarterDilutedShares > 0 && c.quarterRevenueTtm && c.quarterRevenueTtm > 0) {
    const close = lastClose(series, c.ticker, q.unit, now);
    if (close !== null) { priceToSales = close * c.quarterDilutedShares / c.quarterRevenueTtm; stamp ??= series.retrievedAt; }
  }
  return {
    ...base,
    margins: c.quarterMargins ?? [],
    ...(c.marginPeriod ? { marginPeriod: c.marginPeriod } : {}),
    statistics: stamp !== null
      ? { retrievedAt: stamp, quarterEnd: q.end, forwardPE, trailingPE: null, currentRatio: null, totalCash: null, totalDebt, priceToSales }
      : null,
  };
}

/** A company whose filing gives no current period still has a share price: price momentum alone, by the same series rules (the radar no
 *  longer shows nothing at all for it). Nothing else is scored from it. */
function momentumOnly(c: Financials, series: (Raw & { adjust: "splits" }) | undefined, now: number): TwelveFactorEvidence | null {
  if (!series) return null;
  const unit = c.quarterRevenue?.unit ?? c.revenue?.unit;
  const stub = { ticker: c.ticker, currency: unit && /^[A-Z]{3}$/.test(unit) ? unit : "USD", periodEnd: c.quarterRevenue?.end ?? c.revenue?.end ?? new Date(now).toISOString().slice(0, 10), retrievedAt: c.retrievedAt } as TwelveComparisonSnapshot;
  const base = normalizeTwelveFactors(stub, null, undefined, series, now);
  return base.momentum ? { ...base, margins: [], statistics: null } : null;
}

/** The newest completed daily close of a split-adjusted series for this symbol and currency, no older than a week. */
export function lastClose(series: Raw & { adjust: "splits" }, ticker: string, currency: string, now = Date.now()): number | null {
  const root = obj(series.payload), meta = obj(root.meta), at = Date.parse(series.retrievedAt);
  if (root.status === "error" || !sameProviderSymbol(meta.symbol, ticker) || meta.currency !== currency || meta.interval !== "1day" || !Number.isFinite(at) || at > now || !Array.isArray(root.values)) return null;
  const today = new Date(at).toISOString().slice(0, 10);
  const bars = root.values.map(obj).filter(row => typeof row.datetime === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.datetime) && row.datetime < today)
    .sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)));
  const close = bars.length ? twelveNumber(bars[0].close) : null;
  return close !== null && close > 0 && now - Date.parse(String(bars[0].datetime)) <= 7 * 86400000 ? close : null;
}
