import type { Copy } from "../research/data.ts";
import type { PlanInput } from "./plan-data.ts";
import type { RiskArticle } from "./risk.ts";
import { formatReading, RISK_INDICES } from "./risk.ts";
import { RISK_POLICY } from "./risk-policy.ts";
import { notebookResult } from "./plan-summary.ts";
import type { NotificationSettings } from "./notification-settings.ts";
import type { ThermometerSnapshot } from "./thermometer-view.ts";
import { gaugeReading, temperatureLabels } from "./thermometer-view.ts";
import { safeMoves, safeShock, thermometerSession } from "./thermometer-runtime.ts";
import { validSessionDate } from "./thermometer.ts";
import { todayDirection, type TodayCheck, type TodayInput, type TodayPlan } from "./today-plan.ts";

/** Facts behind one member's 「今日やること」 (owner, Nov 25, resolute-pc-1125 §4–§5). Pure functions only: every number the
 * model may use is computed here, rounded once, and passed to it as text. The job (services/resolute-api/today-plan-job.mjs)
 * reads the data; the validator (today-plan-validate.ts) checks the model's output against exactly these facts. */

export const round1 = (n: number) => { const r = Math.round(n * 10) / 10; return Object.is(r, -0) ? 0 : r; };
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}%`;
/** The day's Shock Gauge stories as the shared fixed plan reads them (the same mapping as the home card's todayInput,
 * app/resolute/home/today-card.tsx): stars, and the move of the story's own index (the other index when it has none). */
export function newsOf(articles: readonly RiskArticle[]): TodayInput["news"] {
  return articles.map(a => { const r = a.market.reading, own = a.market.index === "sox" ? r?.sox : r?.nas100, other = a.market.index === "sox" ? r?.nas100 : r?.sox;
    return { stars: a.stars, changePercent: (own ?? other)?.changePercent ?? null }; });
}
/** The gauge the fixed plan shows: the top-rated story's index (TP大型株100 when there is none), as the home card does. */
export function gaugeOf(articles: readonly RiskArticle[], snapshot: ThermometerSnapshot | null | undefined): TodayInput["thermometer"] {
  const top = articles.filter(a => a.stars !== null).sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))[0];
  const index = top?.market.index === "sox" ? "sox" : "nas100", reading = gaugeReading(snapshot ?? undefined, index);
  return reading ? { index, band: reading.band, changePercent: snapshot?.moves?.[index]?.changePercent ?? null } : null;
}
/** Up / down / flat: the shared rule (today-plan.ts todayDirection), so the AI plan and the fixed plan always agree. */
export const marketDirection = (articles: readonly RiskArticle[]) => todayDirection(newsOf(articles)).direction;
export function indexMoves(snapshot: ThermometerSnapshot | null | undefined) {
  const out: { ja: string; en: string }[] = [];
  for (const id of ["nas100", "sox"] as const) {
    const m = snapshot?.moves?.[id];
    if (m && m.date === snapshot?.asOf) out.push({ ja: `${RISK_POLICY.indices[id].ja} ${signed(round1(m.changePercent))}`, en: `${RISK_POLICY.indices[id].en} ${signed(round1(m.changePercent))}` });
  }
  return out;
}

/** 相場の温度計: the band of each index (冷えている … 熱い). Hot = either index reads 「熱い」 (band 4). */
export function thermometerFacts(snapshot: ThermometerSnapshot | null | undefined) {
  const bands = (["nas100", "sox"] as const).flatMap(id => { const r = gaugeReading(snapshot ?? undefined, id); return r ? [{ id, band: r.band }] : []; });
  return {
    hot: bands.some(b => b.band === 4),
    stages: bands.map(b => ({ ja: `${RISK_POLICY.indices[b.id].ja}：${temperatureLabels.ja[b.band]}`, en: `${RISK_POLICY.indices[b.id].en}: ${temperatureLabels.en[b.band]}` })),
  };
}

/** The day's Shock Gauge items (at most three): stars, headline, index moves, and the direction of the story's own index move. */
export function shockItems(articles: readonly RiskArticle[]) {
  return articles.slice(0, 3).map(a => {
    const r = a.market.reading, lead = a.market.index === "company" || !r ? null : r[a.market.index] ?? r[RISK_INDICES.find(i => r[i]) ?? "nas100"];
    return { stars: a.stars, headline: { ja: a.ja.title, en: a.en.title },
      moves: { ja: formatReading(a.market, "ja"), en: formatReading(a.market, "en") },
      direction: lead ? (lead.changePercent > 0 ? "up" : lead.changePercent < 0 ? "down" : "flat") : null };
  });
}
export const maxStars = (articles: readonly RiskArticle[]) => { const s = articles.map(a => a.stars).filter((x): x is number => x !== null); return s.length ? Math.max(...s) : null; };

/** One watched ticker's latest close: daily change and distance to the member's own lines (buy-more lines from the plan,
 * the rise level from the alert settings), both measured from the reference price they saved (split-adjusted by the caller). */
export type WatchClose = { symbol: string; date: string; close: number; previousClose: number | null };
export type WatchFact = {
  symbol: string; close: number; dayChangePct: number | null; fromReferencePct: number; referencePrice: number;
  buyLine: { dropPct: number; reached: boolean; distancePct: number } | null;
  upTarget: { risePct: number; reached: boolean; distancePct: number } | null;
};
export function watchFacts(settings: Pick<NotificationSettings, "watchItems" | "surgeCapPct"> | null, closes: readonly WatchClose[], plan: PlanInput, session: string): WatchFact[] {
  if (!settings) return [];
  const lines = [...new Set(plan.buyLines.map(l => l.dropPct))].sort((a, b) => a - b);
  const out: WatchFact[] = [];
  for (const item of settings.watchItems) {
    const c = closes.find(x => x.symbol === item.symbol && x.date === session);
    if (!c || !(c.close > 0) || !(item.referencePrice > 0)) continue;
    const change = 100 * (c.close / item.referencePrice - 1), drop = -change;
    const reached = lines.filter(l => drop >= l - 1e-9), next = lines.find(l => drop < l - 1e-9);
    const buyLine = reached.length ? { dropPct: reached.at(-1)!, reached: true, distancePct: 0 }
      : next !== undefined ? { dropPct: next, reached: false, distancePct: round1(next - drop) } : null;
    const cap = settings.surgeCapPct;
    out.push({ symbol: item.symbol, close: c.close, referencePrice: item.referencePrice, fromReferencePct: round1(change),
      dayChangePct: c.previousClose && c.previousClose > 0 ? round1(100 * (c.close / c.previousClose - 1)) : null, buyLine,
      upTarget: cap === null ? null : { risePct: cap, reached: change >= cap - 1e-9, distancePct: change >= cap - 1e-9 ? 0 : round1(cap - change) } });
  }
  return out;
}

/** §5 推定の下落. Which index stands in for the member's money (q20 / q21):
 * individual stocks or split holdings + high-tech/semis → TP半導体40; other stocks, funds, ETFs → TP大型株100;
 * bonds → TLT (the Market tab's bond ETF); gold → XAU/USD (the Market tab's metals). null = no matching data. */
export type EstimateIndex = "sox" | "nas100" | "TLT" | "XAU/USD";
export function estimateIndex(answers: PlanInput["answers"]): EstimateIndex | null {
  switch (answers.q20) {
    case "stock": case "mixed": return Array.isArray(answers.q21) && answers.q21.includes("tech_semis") ? "sox" : "nas100";
    case "fund_etf": return "nas100";
    case "bond": return "TLT";
    case "gold": return "XAU/USD";
    default: return null;
  }
}
/** Why no estimate is shown (logged, never shown): fixed codes only. */
export type EstimateMissing = "no-q08" | "no-tolerance" | "no-index" | "no-base-session" | "no-index-data";
/** The base is the last confirmed U.S. close at the moment the plan was saved. Re-taking the diagnosis saves the plan again
 * (updated_at), which makes that day the new base. */
export const estimateBaseSession = (savedAt: Date | string) => { const at = new Date(savedAt); return Number.isFinite(at.getTime()) ? thermometerSession(at) : null; };
export function estimateEligibility(plan: PlanInput): EstimateMissing | null {
  if (plan.answers.q08 !== "input" || !(typeof plan.investedAmount === "number" && plan.investedAmount > 0)) return "no-q08";
  if (plan.tolerancePct === null || !(plan.tolerancePct > 0)) return "no-tolerance";
  return estimateIndex(plan.answers) ? null : "no-index";
}

/** TP index change from `base` to `session`, chained from the stored daily moves (each snapshot's own move and its Shock Gauge
 * map, which also carries the previous sessions). Every link must exist: a missing session gives null, never a guess. */
export type DailyLink = { previousDate: string; changePercent: number };
export function tpIndexLinks(snapshots: readonly { session: string; snapshot: unknown }[], index: "nas100" | "sox") {
  const links = new Map<string, DailyLink>();
  for (const { session, snapshot } of snapshots) {
    const s = snapshot as { moves?: unknown; shock?: unknown } | null;
    if (!s || typeof s !== "object" || !validSessionDate(session)) continue;
    const shock = safeShock(s.shock, session);
    for (const [date, v] of Object.entries(shock ?? {})) { const m = v[index]; if (m) links.set(date, { previousDate: m.previousDate, changePercent: m.changePercent }); }
    const m = safeMoves(s.moves, session)?.[index];
    if (m) links.set(m.date, { previousDate: m.previousDate, changePercent: m.changePercent });
  }
  return links;
}
export function chainedRatio(links: ReadonlyMap<string, DailyLink>, base: string, session: string): number | null {
  if (!validSessionDate(base) || !validSessionDate(session) || base > session) return null;
  let ratio = 1, at = session;
  for (let steps = 0; at > base; steps++) {
    const link = links.get(at);
    if (!link || steps > 2000) return null;
    ratio *= 1 + link.changePercent / 100; at = link.previousDate;
  }
  return at === base ? ratio : null;
}
/** Close-price ratio for TLT / gold: the last daily bar on or before each date (the base bar at most 7 days before the base). */
export function closeRatio(bars: readonly { date: string; close: number }[], base: string, session: string): number | null {
  const sorted = bars.filter(b => validSessionDate(b.date) && b.close > 0).slice().sort((a, b) => a.date.localeCompare(b.date));
  const at = (d: string) => sorted.filter(b => b.date <= d).at(-1);
  const from = at(base), to = sorted.find(b => b.date === session);
  if (!from || !to || (Date.parse(base) - Date.parse(from.date)) / 86400000 > 7) return null;
  return to.close / from.close;
}
/** 「許容できる下落 −30%　推定の目安」「投資額はいま約 −12%　ラインまであと18%」 (percentage points of the base amount). */
export function estimateFromRatio(plan: PlanInput, ratio: number | null): TodayPlan["estimate"] {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0 || plan.tolerancePct === null) return null;
  const estimatedChangePct = round1(100 * (ratio - 1));
  return { allowedDropPct: plan.tolerancePct, estimatedChangePct, remainingPct: Math.max(0, round1(plan.tolerancePct + estimatedChangePct)) };
}

/** The member's own lines reached at the latest close. The exit (損切り) level is a portfolio threshold, so it is judged on the
 * §5 estimate only (never on one ticker). */
export type ReachedLines = { stopLoss: boolean; buyMore: boolean; upTarget: boolean };
export function reachedLines(watch: readonly WatchFact[], plan: PlanInput, estimate: TodayPlan["estimate"]): ReachedLines {
  return {
    stopLoss: !!estimate && plan.stopLossPct != null && estimate.estimatedChangePct <= -plan.stopLossPct,
    buyMore: watch.some(w => w.buyLine?.reached),
    upTarget: watch.some(w => w.upTarget?.reached),
  };
}

/** Candidate rows for the check list (項目名・その人のルール・今日の数字). The state is decided here, never by the model. */
export type CheckFact = TodayCheck & { id: string };
const pct = (n: number) => `${n.toFixed(1).replace(/\.0$/, "")}%`;
export function checkFacts(watch: readonly WatchFact[], plan: PlanInput, estimate: TodayPlan["estimate"]): CheckFact[] {
  const out: CheckFact[] = [];
  if (estimate && plan.stopLossPct != null) {
    const reached = estimate.estimatedChangePct <= -plan.stopLossPct;
    out.push({ id: "stop-loss", state: reached ? "reached" : "ok", label: { ja: "損切りのライン", en: "Exit line" },
      rule: { ja: `−${pct(plan.stopLossPct)}`, en: `−${pct(plan.stopLossPct)}` },
      today: { ja: `推定 約${signed(estimate.estimatedChangePct)}`, en: `Est. about ${signed(estimate.estimatedChangePct)}` } });
  }
  for (const w of watch) {
    if (w.buyLine) out.push({ id: `buy:${w.symbol}`, state: w.buyLine.reached ? "reached" : "ok", label: { ja: `${w.symbol} 買い増し`, en: `${w.symbol} buy-more` },
      rule: { ja: `基準から −${pct(w.buyLine.dropPct)}`, en: `−${pct(w.buyLine.dropPct)} from reference` },
      today: w.buyLine.reached ? { ja: `基準から ${signed(w.fromReferencePct)}`, en: `${signed(w.fromReferencePct)} from reference` }
        : { ja: `${signed(w.fromReferencePct)}（あと${pct(w.buyLine.distancePct)}）`, en: `${signed(w.fromReferencePct)} (${pct(w.buyLine.distancePct)} to go)` } });
    if (w.upTarget) out.push({ id: `up:${w.symbol}`, state: w.upTarget.reached ? "reached" : "ok", label: { ja: `${w.symbol} 上昇の目安`, en: `${w.symbol} rise level` },
      rule: { ja: `基準から +${pct(w.upTarget.risePct)}`, en: `+${pct(w.upTarget.risePct)} from reference` },
      today: { ja: `基準から ${signed(w.fromReferencePct)}`, en: `${signed(w.fromReferencePct)} from reference` } });
  }
  if (estimate) out.push({ id: "tolerance", state: estimate.remainingPct <= 0 ? "reached" : "ok", label: { ja: "許容できる下落", en: "Drop you can accept" },
    rule: { ja: `−${pct(estimate.allowedDropPct)}（推定の目安）`, en: `−${pct(estimate.allowedDropPct)} (estimate)` },
    today: { ja: `約${signed(estimate.estimatedChangePct)}（あと${pct(estimate.remainingPct)}）`, en: `About ${signed(estimate.estimatedChangePct)} (${pct(estimate.remainingPct)} to go)` } });
  // Reached lines first (they are what the day is about), then in the order above.
  return [...out.filter(c => c.state === "reached"), ...out.filter(c => c.state === "ok")];
}
export const publicCheck = ({ label, rule, today, state }: CheckFact): TodayCheck => ({ label, rule, today, state });

/** Everything the model is given, as one JSON-able object. Numbers appear only as they will be allowed in the output. */
export type TodayFacts = {
  date: string; direction: TodayPlan["direction"]; stars: number | null;
  shock: { state: "ready" | "unavailable"; items: ReturnType<typeof shockItems> };
  indexMoves: ReturnType<typeof indexMoves>;
  thermometer: ReturnType<typeof thermometerFacts>;
  watch: WatchFact[]; checks: CheckFact[];
  estimate: TodayPlan["estimate"];
  reached: ReachedLines;
  /** The shared fixed plan's input (today-plan.ts fixedTodayPlan): the fallback when the model's output cannot be used. */
  todayInput: TodayInput;
};
export function modelInput(facts: TodayFacts, plan: PlanInput, recentHeadlines: readonly string[]) {
  const rules = (locale: "ja" | "en") => notebookResult(plan, locale).rows.map(r => ({ item: r.item, rule: r.rule, meaning: r.meaning }));
  return {
    marketDate: facts.date, direction: facts.direction, highestStars: facts.stars,
    shockGauge: facts.shock, tpIndexMoves: facts.indexMoves, thermometer: facts.thermometer.stages, thermometerHot: facts.thermometer.hot,
    watched: facts.watch.map(w => ({ symbol: w.symbol, close: w.close, dayChangePct: w.dayChangePct, fromReferencePct: w.fromReferencePct,
      buyLine: w.buyLine, upTarget: w.upTarget })),
    linesReached: facts.reached,
    estimate: facts.estimate ? { ...facts.estimate, note: "estimate only (推定の目安)" } : null,
    checkCandidates: facts.checks.map(c => ({ id: c.id, state: c.state, label: c.label, rule: c.rule, today: c.today })),
    plan: { answers: plan.answers, ruleType: plan.ruleType, tolerancePct: plan.tolerancePct, stopLossPct: plan.stopLossPct ?? null,
      buyLines: plan.buyLines.map(l => l.dropPct), perStockCapPct: plan.perStockCapPct, noBuyConditions: plan.noBuyConditions, haltConditions: plan.haltConditions,
      rulebook: { ja: rules("ja"), en: rules("en") } },
    recentHeadlines,
  };
}
export const copyOf = (c: Copy): Copy => ({ ja: c.ja, en: c.en });
