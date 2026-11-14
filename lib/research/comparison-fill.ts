import type { Financials } from "./comparison.ts";
import { twelveExtraFactors } from "./twelve-data-factors.ts";

const day = (s: string) => Date.parse(s) / 86400000;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** The same quarter, by its end date (the provider's 52/53-week calendars can differ from the filing by a few days). */
export function sameQuarter(a: Financials, b: Financials | null | undefined): boolean {
  const x = a.quarterRevenue?.end, y = b?.quarterRevenue?.end;
  return !!x && !!y && Math.abs(day(x) - day(y)) <= 10;
}

/** A filing-based company keeps every figure the filing gives; only a factor the filing leaves empty is taken from the provider's
 * statements for the SAME quarter (owner, Nov 14: "どの銘柄でも全ての数字を"). Nothing from another quarter is mixed in, nothing is invented,
 * and each borrowed factor is listed in `supplemented` so the screen can say so. */
export function fillFromProvider(sec: Financials, provider: Financials | null | undefined, now = Date.now()): Financials {
  if (!provider || provider.status !== "ready" || !sameQuarter(sec, provider)) return sec;
  const out: Financials = { ...sec };
  const supplemented = new Set(sec.supplemented ?? []);
  if (!finite(out.quarterRevenueGrowth) && finite(provider.quarterRevenueGrowth)) {
    out.quarterRevenueGrowth = provider.quarterRevenueGrowth; out.previousQuarterRevenue = provider.previousQuarterRevenue; supplemented.add("growth");
  }
  if (!finite(out.quarterOperatingMargin) && finite(provider.quarterOperatingMargin)) {
    out.quarterOperatingMargin = provider.quarterOperatingMargin; out.quarterOperatingIncome = provider.quarterOperatingIncome; supplemented.add("profitability");
  }
  if (!finite(out.quarterFcfMargin) && finite(provider.quarterFcfMargin)) { out.quarterFcfMargin = provider.quarterFcfMargin; supplemented.add("cash"); }
  const mine = out.twelveData, theirs = provider.twelveData;
  if (mine && theirs) {
    let evidence = mine;
    if (mine.margins.length !== 4 && theirs.margins.length === 4) { evidence = { ...evidence, margins: theirs.margins }; supplemented.add("stability"); }
    // Financial strength from the provider's balance only when the filing's own balance gives no score.
    const s = theirs.statistics;
    if (out.supplementedFinancialAllowed !== false && s && s.currentRatio !== null && s.totalCash !== null && s.totalDebt !== null
      && twelveExtraFactors({ ...theirs }, now).financial !== null) {
      evidence = { ...evidence, statistics: { ...(evidence.statistics ?? { retrievedAt: s.retrievedAt, quarterEnd: s.quarterEnd, forwardPE: null, trailingPE: null, priceToSales: null }),
        currentRatio: s.currentRatio, totalCash: s.totalCash, totalDebt: s.totalDebt } };
      supplemented.add("financial");
    }
    if (!evidence.momentum && theirs.momentum) { evidence = { ...evidence, momentum: theirs.momentum }; supplemented.add("momentum"); }
    if (!evidence.statistics?.forwardPE && !evidence.statistics?.priceToSales && (theirs.statistics?.forwardPE || theirs.statistics?.priceToSales)) {
      evidence = { ...evidence, statistics: { ...(evidence.statistics ?? theirs.statistics!), forwardPE: theirs.statistics!.forwardPE, priceToSales: theirs.statistics!.priceToSales ?? null } };
      supplemented.add("valuation");
    }
    out.twelveData = evidence;
  } else if (!mine && theirs) { out.twelveData = theirs; supplemented.add("market"); }
  out.supplemented = [...supplemented];
  return out;
}
