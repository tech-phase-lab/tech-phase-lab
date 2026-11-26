import type { Financials } from "./comparison.ts";
import { twelveFactorMethods } from "./twelve-data-factors.ts";

/** The Stock Comparison's valuation (owner, Nov 26): Treasure Hunt's own calculation, the company against its own five-year average.
 *  scripts/research/value_check.py saves, for every ticker it can calculate (ranked or not), the halves of the Value Score; the comparison reads
 *  that list (the snapshot's `values`) and never recalculates. A ticker outside Treasure Hunt's universe, or one it cannot calculate, is 未取得. */
export type ValueFigure = {
  /** Value Score in percent, rounded as on Treasure Hunt (positive: below the average). */
  score: number; exact: number;
  /** Each half in percent; pe is null when the P/E cannot be used (a loss, thin earnings): the score is then the P/S half alone. */
  pe: number | null; ps: number; peNow: number | null; psNow: number;
  basis: "pe-ps" | "ps";
  /** Why the look-back is shorter than five years, as on Treasure Hunt: "listed" recently, or filings ("data") that start later. */
  period: "listed" | "data" | null;
  /** The close the list describes. */
  asOf: string;
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** One entry of the monitor's list; null when it does not fit (a bad entry never breaks Treasure Hunt or the comparison). */
export function parseValueFigure(raw: unknown, asOf: string): ValueFigure | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!finite(r.score) || !finite(r.exact) || !finite(r.ps) || !finite(r.psNow) || Math.abs(r.exact) > 100_000) return null;
  const basis = r.basis === "ps" ? "ps" : r.basis === "pe-ps" ? "pe-ps" : null;
  if (!basis || (basis === "pe-ps" && (!finite(r.pe) || !finite(r.peNow)))) return null;
  return { score: Math.round(r.score), exact: r.exact, pe: basis === "pe-ps" ? r.pe as number : null, ps: r.ps, peNow: basis === "pe-ps" ? r.peNow as number : null,
    psNow: r.psNow, basis, period: r.period === "listed" || r.period === "data" ? r.period : null, asOf };
}

/** Points out of ten: the average itself scores 5, 50% below scores 10, 50% above scores 0 (clamp(5 + score / 10, 0, 10)). */
export function valueFigureScore(v: ValueFigure): number {
  return Math.round(Math.max(0, Math.min(10, 5 + v.score / 10)) * 10) / 10;
}

/** 「5年平均より36%安い」 / "36% below its 5-year average", with Treasure Hunt's shorter period named when the history is shorter. */
export function valueFigureText(v: ValueFigure, lang: "ja" | "en"): string {
  const ja = lang === "ja";
  const average = v.period === "listed" ? (ja ? "上場来平均" : "its average since listing")
    : v.period === "data" ? (ja ? "取得できた期間の平均" : "its average over the available period") : (ja ? "5年平均" : "its 5-year average");
  if (Math.abs(v.exact) < 0.5 || v.score === 0) return ja ? `${average}と同じ水準` : `In line with ${average}`;
  const pct = Math.abs(v.score);
  if (v.score > 0) return ja ? `${average}より${pct}%安い` : `${pct}% below ${average}`;
  return ja ? `${average}より${pct}%高い` : `${pct}% above ${average}`;
}

type Snapshot = { values?: Record<string, ValueFigure> } | null | undefined;
/** Each company's figure from Treasure Hunt's list (null: 未取得), and its valuation point in the strengths and weaknesses (7 or more a
 *  strength, 3 or less a weakness, as before) in the same words. Any valuation point made from the old fixed scale is removed. */
export function applyValueCheck<T extends Financials & { ticker: string }>(companies: T[], snapshot: Snapshot): T[] {
  return companies.map(c => {
    if (c.referenceEvaluation) return c;
    const valueCheck = snapshot?.values?.[c.ticker] ?? null;
    const prepared = c.preparedAnalysis ? { ...c.preparedAnalysis, items: c.preparedAnalysis.items.filter(item => item.id !== "valuation") } : c.preparedAnalysis;
    if (prepared && valueCheck) {
      const value = valueFigureScore(valueCheck);
      if (value >= 7 || value <= 3) prepared.items.push({ id: "valuation", kind: value >= 7 ? "strength" : "weakness",
        short: { ja: valueFigureText(valueCheck, "ja"), en: valueFigureText(valueCheck, "en") }, detail: twelveFactorMethods.valuation });
    }
    return { ...c, valueCheck, preparedAnalysis: prepared };
  });
}
