import type { Financials } from "./comparison.ts";
import { twelveFactorMethods } from "./twelve-data-factors.ts";

/** The Stock Comparison's valuation (owner, Nov 26): Treasure Hunt's own calculation, the company against its own five-year average.
 *  scripts/research/value_check.py saves, for every ticker it can calculate (ranked or not), the halves of the Value Score; the comparison reads
 *  that list (the snapshot's `values`) and never recalculates. Since Nov 26 the monitor extends the same calculation to every comparable
 *  company (scripts/research/compare_values.py), with P/B for a company with no revenue and a shorter history for a recent listing. */
export type ValueFigure = {
  /** Value Score in percent, rounded as on Treasure Hunt (positive: below the average). */
  score: number; exact: number;
  /** "pe-ps": P/E and P/S as Treasure Hunt; "ps": P/S alone (a loss, thin earnings); "pb": P/B, for a company with no revenue yet. */
  basis: "pe-ps" | "ps" | "pb";
  /** Why the look-back is shorter than five years, as on Treasure Hunt: "listed" recently, or filings ("data") that start later. */
  period: "listed" | "data" | null;
  /** The close the list describes. */
  asOf: string;
  /** Each half in percent (Treasure Hunt's own rows only; the compact list leaves them out). */
  pe?: number | null; ps?: number | null; peNow?: number | null; psNow?: number | null;
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const BASES = ["pe-ps", "ps", "pb"] as const;
/** One entry of the monitor's list, compact ([score, exact, basis, period]) or a full row; null when it does not fit (a bad entry never
 *  breaks Treasure Hunt or the comparison). */
export function parseValueFigure(raw: unknown, asOf: string): ValueFigure | null {
  const r = Array.isArray(raw) ? { score: raw[0], exact: raw[1], basis: raw[2], period: raw[3] } : (raw ?? {}) as Record<string, unknown>;
  if (!finite(r.score) || !finite(r.exact) || Math.abs(r.exact) > 100_000) return null;
  const basis = BASES.find(b => b === r.basis);
  if (!basis) return null;
  return { score: Math.round(r.score), exact: r.exact, basis, period: r.period === "listed" || r.period === "data" ? r.period : null, asOf };
}

/** A figure counts only while its close is at most VALUE_MAX_AGE_DAYS old (reviewer, Nov 26: if the monitor stopped, an old score would
 *  otherwise show as current); older is 未取得. */
export const VALUE_MAX_AGE_DAYS = 7;
export function valueFigureCurrent(v: ValueFigure, now = Date.now()): boolean {
  const age = now - Date.parse(`${v.asOf}T23:59:59Z`);
  return Number.isFinite(age) && age <= VALUE_MAX_AGE_DAYS * 86_400_000;
}

/** Points out of ten: the average itself scores 5, 50% below scores 10, 50% above scores 0 (clamp(5 + score / 10, 0, 10)). */
export function valueFigureScore(v: ValueFigure): number {
  return Math.round(Math.max(0, Math.min(10, 5 + v.score / 10)) * 10) / 10;
}

/** Every wording of the valuation line in one place (owner, Nov 26: the P/B wording is shown to the owner before the release). `avg` is
 *  the average named for the company's period; `pct` a whole percent. */
export const VALUE_LABELS = {
  // A history shorter than five years is named as Treasure Hunt names it (periodNote: 「上場後の期間で計算」「決算データのある期間で計算」).
  average: { full: { ja: "5年平均", en: "its 5-year average" }, listed: { ja: "上場後の平均", en: "its average since listing" },
    data: { ja: "決算データのある期間の平均", en: "its average over the available filings" } },
  below: { ja: (avg: string, pct: number) => `${avg}より${pct}%安い`, en: (avg: string, pct: number) => `${pct}% below ${avg}` },
  above: { ja: (avg: string, pct: number) => `${avg}より${pct}%高い`, en: (avg: string, pct: number) => `${pct}% above ${avg}` },
  same: { ja: (avg: string) => `${avg}と同じ水準`, en: (avg: string) => `In line with ${avg}` },
  // P/B, for a company with no revenue yet: the metric is named so the line is not read as P/E and P/S.
  pbBelow: { ja: (avg: string, pct: number) => `純資産倍率（PBR）が${avg}より${pct}%安い`, en: (avg: string, pct: number) => `P/B ${pct}% below ${avg}` },
  pbAbove: { ja: (avg: string, pct: number) => `純資産倍率（PBR）が${avg}より${pct}%高い`, en: (avg: string, pct: number) => `P/B ${pct}% above ${avg}` },
  pbSame: { ja: (avg: string) => `純資産倍率（PBR）が${avg}と同じ水準`, en: (avg: string) => `P/B in line with ${avg}` },
  // The strengths and weaknesses card holds one line of about 12 characters (owner, Nov 15): there 「純資産倍率（PBR）」 is shortened to 「PBR」.
  pbShortName: { ja: "純資産倍率（PBR）が", short: "PBRが" },
  /** How many lines a strengths/weaknesses item may take: 1 (today: one line, the short P/B name, cut with "…") or 2 (option A, waiting
   *  for the owner: the full line over two lines). */
  traitLines: 1 as 1 | 2,
  /** The close the valuation describes, under the comparison snapshot (as Treasure Hunt's footer). */
  asOf: { ja: (md: string) => `割安性は${md}の終値で計算`, en: (md: string) => `Valuation as of the ${md} close` },
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 「割安性は11/25の終値で計算」 / "Valuation as of the Nov 25 close" for the newest current figure among the companies; null without one. */
export function valueAsOfLine(companies: { valueCheck?: ValueFigure | null }[], lang: "ja" | "en", now = Date.now()): string | null {
  const day = companies.map(c => c.valueCheck).filter((v): v is ValueFigure => !!v && valueFigureCurrent(v, now)).map(v => v.asOf).sort().at(-1);
  if (!day) return null;
  const md = lang === "ja" ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}` : `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
  return VALUE_LABELS.asOf[lang](md);
}

/** 「5年平均より36%安い」 / "36% below its 5-year average", with Treasure Hunt's shorter period named when the history is shorter, and
 *  the P/B wording when the figure is P/B. */
export function valueFigureText(v: ValueFigure, lang: "ja" | "en"): string {
  const L = VALUE_LABELS, pb = v.basis === "pb";
  const average = L.average[v.period ?? "full"][lang];
  if (Math.abs(v.exact) < 0.5 || v.score === 0) return (pb ? L.pbSame : L.same)[lang](average);
  const pct = Math.abs(v.score);
  return v.score > 0 ? (pb ? L.pbBelow : L.below)[lang](average, pct) : (pb ? L.pbAbove : L.above)[lang](average, pct);
}

type Item = NonNullable<Financials["preparedAnalysis"]>["items"][number];
/** The valuation point in the strengths and weaknesses: 7 or more a strength, 3 or less a weakness (as before), in the line's own words.
 *  It does not depend on the latest quarter, so a company without one (no revenue yet) still shows it. */
export function valueCheckItem(v: ValueFigure | null | undefined): Item | null {
  if (!v) return null;
  const value = valueFigureScore(v);
  if (value > 3 && value < 7) return null;
  const full = valueFigureText(v, "ja"), ja = VALUE_LABELS.traitLines === 2 ? full : full.replace(VALUE_LABELS.pbShortName.ja, VALUE_LABELS.pbShortName.short);
  return { id: "valuation", kind: value >= 7 ? "strength" : "weakness", short: { ja, en: valueFigureText(v, "en") }, detail: twelveFactorMethods.valuation };
}

type Snapshot = { values?: Record<string, ValueFigure> } | null | undefined;
/** Each company's figure from Treasure Hunt's list (null: 未取得), and its valuation point in the strengths and weaknesses (7 or more a
 *  strength, 3 or less a weakness, as before) in the same words. Any valuation point made from the old fixed scale is removed. */
export function applyValueCheck<T extends Financials & { ticker: string }>(companies: T[], snapshot: Snapshot, now = Date.now()): T[] {
  return companies.map(c => {
    if (c.referenceEvaluation) return c;
    const found = snapshot?.values?.[c.ticker] ?? null;
    const valueCheck = found && valueFigureCurrent(found, now) ? found : null;
    const prepared = c.preparedAnalysis ? { ...c.preparedAnalysis, items: c.preparedAnalysis.items.filter(item => item.id !== "valuation") } : c.preparedAnalysis;
    const item = valueCheckItem(valueCheck);
    if (prepared && item) prepared.items.push(item);
    return { ...c, valueCheck, preparedAnalysis: prepared };
  });
}
