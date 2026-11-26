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
/** The provider is one quarter behind the filing (it often adds a new quarter weeks after the 10-Q: ConocoPhillips, Southern, Nov 14). */
export function previousQuarter(a: Financials, b: Financials | null | undefined): boolean {
  const x = a.quarterRevenue?.end, y = b?.quarterRevenue?.end;
  return !!x && !!y && day(x) - day(y) >= 75 && day(x) - day(y) <= 105;
}

export function fillFromProvider(sec: Financials, provider: Financials | null | undefined, now = Date.now()): Financials {
  if (!provider || provider.status !== "ready") return sec;
  // One quarter behind: only factors that do not compare this quarter with another (cash generation, the margin series, the balance,
  // price) are taken, and the screen names the quarter they come from. Growth and profitability are never taken from another quarter.
  const lagging = !sameQuarter(sec, provider) && previousQuarter(sec, provider);
  if (!sameQuarter(sec, provider) && !lagging) return sec;
  const out: Financials = { ...sec };
  const supplemented = new Set(sec.supplemented ?? []);
  const before = supplemented.size;
  if (lagging) {
    if (fcfFillable(out, provider)) { out.quarterFcfMargin = provider.quarterFcfMargin; delete out.fcfPeriod; supplemented.add("cash"); }
    fillMarket(out, provider, supplemented, now);
    out.supplemented = [...supplemented];
    if (supplemented.size > before) out.supplementedFromQuarter = provider.quarterRevenue!.end;
    return out;
  }
  if (!finite(out.quarterRevenueGrowth) && !out.growthWithheld && finite(provider.quarterRevenueGrowth)) {
    out.quarterRevenueGrowth = provider.quarterRevenueGrowth; out.previousQuarterRevenue = provider.previousQuarterRevenue; supplemented.add("growth");
  }
  // A margin the filing withholds (operating income above revenue) is not taken from the provider either; nor is any margin above 100%.
  if (!finite(out.quarterOperatingMargin) && !out.marginWithheld && !out.marginPartial && finite(provider.quarterOperatingMargin) && provider.quarterOperatingMargin <= 100) {
    out.quarterOperatingMargin = provider.quarterOperatingMargin; out.quarterOperatingIncome = provider.quarterOperatingIncome; supplemented.add("profitability");
  }
  // A fiscal year's figure that stood in for the quarter (fcfPeriod, marginPeriod "annual") gives way to the provider's same quarter.
  if (fcfFillable(out, provider)) { out.quarterFcfMargin = provider.quarterFcfMargin; delete out.fcfPeriod; supplemented.add("cash"); }
  fillMarket(out, provider, supplemented, now);
  out.supplemented = [...supplemented];
  return out;
}

/** Cash generation from the provider: only where the filing gives none (or only a fiscal year's), never where the filing withholds it on
 *  purpose (a bank's free cash flow, cash flow above revenue: fcfWithheld), and never a figure above 100% of revenue. */
function fcfFillable(out: Financials, provider: Financials): boolean {
  return (!finite(out.quarterFcfMargin) || out.fcfPeriod === "annual") && !out.fcfWithheld && !out.financeSic && finite(provider.quarterFcfMargin) && provider.quarterFcfMargin <= 100;
}

function fillMarket(out: Financials, provider: Financials, supplemented: Set<string>, now: number) {
  const mine = out.twelveData, theirs = provider.twelveData;
  if (mine && theirs) {
    let evidence = mine;
    if (!out.marginPartial && (mine.margins.length !== 4 || mine.marginPeriod === "annual") && theirs.margins.length === 4 && theirs.marginPeriod !== "annual") {
      evidence = { ...evidence, margins: theirs.margins }; delete evidence.marginPeriod; supplemented.add("stability");
    }
    // Financial strength from the provider's balance only when the filing's own balance gives no score.
    const s = theirs.statistics;
    if (out.supplementedFinancialAllowed !== false && s && s.totalCash !== null && s.totalDebt !== null
      && twelveExtraFactors({ ...theirs }, now).financial !== null) {
      evidence = { ...evidence, statistics: { ...(evidence.statistics ?? { retrievedAt: s.retrievedAt, quarterEnd: s.quarterEnd, forwardPE: null, trailingPE: null, priceToSales: null }),
        currentRatio: s.currentRatio, totalCash: s.totalCash, totalDebt: s.totalDebt } };
      supplemented.add("financial");
    }
    if (!evidence.momentum && theirs.momentum) { evidence = { ...evidence, momentum: theirs.momentum }; supplemented.add("momentum"); }
    // Valuation is not filled from the provider: it comes from Treasure Hunt's list for every company (owner, Nov 26).
    out.twelveData = evidence;
  } else if (!mine && theirs) { out.twelveData = theirs; supplemented.add("market"); }
}

/** The provider's own statements stand for a company (an IFRS filer, a newer quarter, no filing figures): what the filing withholds on purpose
 *  is withheld from them too (reviewer, Nov 26): a bank's, broker's or insurer's free cash flow (its ROE from the filing stands in), and a
 *  margin and margin series on an IFRS bank's partial revenue. */
export function carryWithholding(provider: Financials, sec: Financials): Financials {
  if (!sec.financeSic && sec.fcfWithheld !== "finance" && !sec.marginPartial && !sec.sectorKind) return provider;
  const out: Financials = { ...provider };
  if (sec.sectorKind) {
    out.sectorKind = sec.sectorKind;
    if (!out.sectorMetrics && sec.sectorMetrics) out.sectorMetrics = sec.sectorMetrics;
    if (out.twelveData) out.twelveData = { ...out.twelveData, sectorFinancial: true };
  }
  if (sec.financeSic || sec.fcfWithheld === "finance") {
    out.quarterFcfMargin = null; out.fcfWithheld = "finance"; out.financeSic = true; delete out.fcfPeriod;
    if (!out.sectorMetrics && sec.sectorMetrics) out.sectorMetrics = sec.sectorMetrics;
  }
  if (sec.marginPartial) {
    out.quarterOperatingMargin = null; out.marginPartial = true; out.quarterMargins = null;
    if (out.twelveData) out.twelveData = { ...out.twelveData, margins: [] };
  }
  return out;
}
