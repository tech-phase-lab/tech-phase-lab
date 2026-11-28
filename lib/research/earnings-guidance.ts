import type { ResultBrief, ResultFact } from "./market-results.ts";
import { resultPeriodKey } from "./earnings-results-history.ts";

/**
 * The company's own outlook from its previous results release (owner, Nov 28): 「会社予想」 under this quarter's revenue is what the
 * company guided for this quarter one release earlier, and an outlook of this release is 「上方修正／下方修正／据え置き」 against the
 * same period's outlook of the previous release. Both come only from the stored results (the issuer's release tables): nothing is
 * estimated, and a release we did not store gives nothing.
 */
export type Horizon = "quarter" | "year";

/** Whether an outlook is for the next quarter or the full year, from its key and its label; null when the label does not say. */
export function guidanceHorizon(fact: Pick<ResultFact, "key" | "ja" | "en">): Horizon | null {
  if (!fact.key.startsWith("guidance-") && fact.key !== "capex-guidance") return null;
  const label = `${fact.ja} ${fact.en}`;
  if (fact.key.startsWith("guidance-fy-") || /通期|full[- ]year|fiscal year/i.test(label)) return "year";
  if (/次四半期|next[- ]quarter|\(next quarter\)/i.test(label)) return "quarter";
  return null;
}

/** "Q3 FY2027" / "Q3 FY27" / "Q3 2026" / "2026Q3" -> quarter and (fiscal) year; null for anything else. */
export function quarterOf(period: string): { quarter: number; year: number } | null {
  const key = resultPeriodKey(period);
  const m = /^Q([1-4])(?:FY)?(20\d\d)$/.exec(key) ?? null;
  if (m) return { quarter: Number(m[1]), year: Number(m[2]) };
  const r = /^(20\d\d)Q([1-4])$/.exec(key);
  return r ? { quarter: Number(r[2]), year: Number(r[1]) } : null;
}

const DAY = 86_400_000;
/** The company's results release of the quarter just before this one (an issuer table, `ir-`), from the stored results; null when not stored. */
export function priorRelease(brief: Pick<ResultBrief, "ticker" | "period" | "publishedAt">, stored: ResultBrief[]): ResultBrief | null {
  const now = quarterOf(brief.period), at = Date.parse(brief.publishedAt);
  if (!now || !Number.isFinite(at)) return null;
  const want = now.quarter === 1 ? { quarter: 4, year: now.year - 1 } : { quarter: now.quarter - 1, year: now.year };
  const found = stored.filter(other => other.kind === "earnings" && other.researchId.startsWith("ir-") && other.ticker === brief.ticker && other.facts.length
    && (() => { const q = quarterOf(other.period); const gap = at - Date.parse(other.publishedAt); return q?.quarter === want.quarter && q.year === want.year && gap > 30 * DAY && gap < 150 * DAY; })());
  return found.toSorted((a, b) => b.facts.length - a.facts.length)[0] ?? null;
}

/**
 * This release's facts with the previous release's outlook for the same period attached (comparisons.priorGuidance) where the release
 * itself did not state it, and the revenue outlook the company gave for this quarter one release ago.
 * A full-year outlook is compared only inside one fiscal year (this quarter is not the first); a next-quarter outlook never is.
 */
export function withPriorOutlook(brief: Pick<ResultBrief, "period" | "facts">, prior: ResultBrief | null): { facts: ResultFact[]; revenueGuidance: string | null } {
  if (!prior) return { facts: brief.facts, revenueGuidance: null };
  const revenueGuidance = prior.facts.find(fact => fact.key === "guidance-revenue" && guidanceHorizon(fact) === "quarter")?.value ?? null;
  const sameYear = (quarterOf(brief.period)?.quarter ?? 1) > 1;
  const facts = brief.facts.map(fact => {
    const horizon = guidanceHorizon(fact);
    if ((fact.comparisons as { priorGuidance?: string } | undefined)?.priorGuidance || horizon !== "year" || !sameYear) return fact;
    const before = prior.facts.find(other => other.key === fact.key && guidanceHorizon(other) === "year");
    return before ? { ...fact, comparisons: { ...fact.comparisons, priorGuidance: before.value } } : fact;
  });
  return { facts, revenueGuidance };
}
