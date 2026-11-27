import { validSyncToken } from "../membership/sync-auth.ts";
import type { ComparisonResult, Financials } from "./comparison.ts";
import { balanceDebt, comparableQuarters, comparisonScores, hasRecentBalance, hasRecentQuarter, listedTraits, type ScoreId } from "./comparison-scorecard.ts";
import { valueCheckItem } from "./comparison-value.ts";

/** HQ's production check of the PRO-only Stock Comparison (app/api/research/internal/pro-check): the real comparison of a fixed set of large
 *  caps, read from the same shared stores a member's comparison reads, summarised as which of the seven factors each company has, the
 *  strengths and weaknesses its card lists and any figure that cannot be right. Called once a day by the production patrol
 *  (scripts/research/production_watch.py, check `proCompare`) with `Authorization: Bearer <COMPARISON_WARM_SECRET>`, the secret the
 *  monitor already sends to the comparison's warm job. No member data is read or returned. */
export const PRO_CHECK_PAIRS: readonly (readonly [string, string])[] = [
  ["BRK-B", "ORCL"], ["NVDA", "AMD"], ["JPM", "GS"], ["PG", "KO"], ["MET", "PRU"], ["AAPL", "MSFT"],
];
export const FACTOR_IDS: readonly ScoreId[] = ["financial", "profitability", "valuation", "stability", "momentum", "growth", "cash"];

/** Only a server-to-server call: the monitor's bearer secret (32+ characters, constant-time compare) and no browser markers. A browser
 *  always sends Origin on a cross-origin fetch and Sec-Fetch-Mode on any fetch, and the route answers without CORS headers either way. */
export function proCheckAuthorized(headers: Headers, secret: string | undefined): boolean {
  if (headers.get("origin") || headers.get("sec-fetch-mode") || headers.get("sec-fetch-site")) return false;
  return validSyncToken(headers.get("authorization"), secret);
}

type Item = NonNullable<Financials["preparedAnalysis"]>["items"][number];
/** The 長所 / 短所 a company card lists, chosen exactly as CompanyScoreCard (app/research/compare/comparison-visuals.tsx) does: the
 *  prepared bullets when the latest period is current, the valuation point written from the figure, at most four of each. */
export function cardTraits(c: Financials, now = Date.now()): { strengths: Item[]; weaknesses: Item[] } {
  const valuation = valueCheckItem(c.valueCheck);
  const prepared = (hasRecentQuarter(c, now) || hasRecentBalance(c, now)) && c.preparedAnalysis ? c.preparedAnalysis.items : null;
  const items = listedTraits(c, prepared ? prepared.flatMap(i => i.id !== "valuation" ? [i] : valuation ? [valuation] : []) : valuation ? [valuation] : [], now);
  return { strengths: items.filter(i => i.kind === "strength").slice(0, 4), weaknesses: items.filter(i => i.kind === "weakness").slice(0, 4) };
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
/** Every number anywhere in the company's answer that is NaN or infinite (JSON would turn it into null), as a dotted path. */
function nonFinitePaths(value: unknown, path: string, out: string[], depth = 0) {
  if (out.length >= 20 || depth > 6) return;
  if (typeof value === "number") { if (!Number.isFinite(value)) out.push(path); return; }
  if (Array.isArray(value)) { value.forEach((v, i) => nonFinitePaths(v, `${path}[${i}]`, out, depth + 1)); return; }
  if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) nonFinitePaths(v, path ? `${path}.${k}` : k, out, depth + 1);
}

/** Figures that cannot be right for a listed large cap, as short codes ("absurd:quarterOperatingMargin", "negative:debt", ...). Each code
 *  names a field, never its value. */
export function invalidNumbers(c: Financials, now = Date.now()): string[] {
  const out: string[] = [];
  nonFinitePaths(c, "", out);
  const found = out.map(p => `nonFinite:${p}`);
  if (c.status !== "ready") found.push(`status:${c.status}`);
  if (c.status === "ready" && !c.quarterRevenue && !c.preRevenue) found.push("missing:quarterRevenue");
  const margin = (name: string, v: number | null | undefined) => { if (finite(v) && (v > 100 || v < -100)) found.push(`absurd:${name}`); };
  margin("quarterOperatingMargin", c.quarterOperatingMargin);
  margin("quarterFcfMargin", c.quarterFcfMargin);
  margin("operatingMargin", c.operatingMargin);
  margin("fcfMargin", c.fcfMargin);
  for (const [name, v] of [["quarterRevenueGrowth", c.quarterRevenueGrowth], ["revenueGrowth", c.revenueGrowth]] as const)
    if (finite(v) && (v > 1000 || v < -100)) found.push(`absurd:${name}`);
  for (const m of c.quarterMargins ?? []) if (finite(m.value) && (m.value > 100 || m.value < -100)) { found.push("absurd:quarterMargins"); break; }
  for (const [name, f] of [["quarterRevenue", c.quarterRevenue], ["revenue", c.revenue], ["dilutedShares", c.dilutedShares]] as const)
    if (f && finite(f.value) && f.value <= 0 && !c.zeroQuarter) found.push(`nonPositive:${name}`);
  const b = c.balance;
  if (b) {
    for (const [name, f] of [["cash", b.cash], ["debtCurrent", b.debtCurrent], ["debtNoncurrent", b.debtNoncurrent], ["shortBorrowings", b.shortBorrowings],
      ["currentAssets", b.currentAssets], ["currentLiabilities", b.currentLiabilities], ["assets", b.assets ?? null]] as const)
      if (f && finite(f.value) && f.value < 0) found.push(`negative:${name}`);
    if (b.debtTotal && finite(b.debtTotal.value) && b.debtTotal.value < 0) found.push("negative:debtTotal");
    if (finite(b.currentRatio) && b.currentRatio < 0) found.push("negative:currentRatio");
  }
  const debt = balanceDebt(c);
  if (finite(debt) && debt < 0 && !found.some(code => code.startsWith("negative:debt"))) found.push("negative:debt");
  for (const s of comparisonScores(c, now)) if (s.value !== null && (!finite(s.value) || s.value < 0 || s.value > 10)) found.push(`score:${s.id}`);
  for (const [name, f] of [["quarterRevenue", c.quarterRevenue], ["balance", b]] as const)
    if (f && (!/^\d{4}-\d{2}-\d{2}$/.test(f.end) || Date.parse(f.end) > now + 86400000)) found.push(`date:${name}`);
  return [...new Set(found)];
}

type Line = { id: string; ja: string; en: string };
export type ProCheckCompany = {
  ticker: string; status: Financials["status"];
  factors: { present: ScoreId[]; missing: ScoreId[]; kinds: Partial<Record<ScoreId, string>> };
  strengths: Line[]; weaknesses: Line[]; invalid: string[];
};
export type ProCheckPair = { tickers: string[]; ok: true; comparable: boolean; companies: ProCheckCompany[] } | { tickers: string[]; ok: false; error: string };

export function summarizeCompany(c: Financials, now = Date.now()): ProCheckCompany {
  const scores = comparisonScores(c, now);
  const value = (id: ScoreId) => scores.find(s => s.id === id);
  const present = FACTOR_IDS.filter(id => value(id)?.value !== null && value(id)?.value !== undefined);
  const kinds: Partial<Record<ScoreId, string>> = {};
  for (const s of scores) if (s.kind && s.value !== null) kinds[s.id] = s.kind;
  const traits = cardTraits(c, now);
  const line = (i: Item): Line => ({ id: i.id, ja: i.short.ja, en: i.short.en });
  return { ticker: c.ticker, status: c.status, factors: { present, missing: FACTOR_IDS.filter(id => !present.includes(id)), kinds },
    strengths: traits.strengths.map(line), weaknesses: traits.weaknesses.map(line), invalid: invalidNumbers(c, now) };
}

export function summarizeComparison(result: ComparisonResult, now = Date.now()): ProCheckPair {
  return { tickers: result.companies.map(c => c.ticker), ok: true, comparable: comparableQuarters(result.companies, now),
    companies: result.companies.map(c => summarizeCompany(c, now)) };
}
