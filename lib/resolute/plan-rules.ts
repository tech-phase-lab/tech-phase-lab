// RESOLUTE: the member's own rules as short facts, for the ② simulation (PC rule cards, gauge, cap bars) and the
// 「今日のお知らせ」 cards. Pure functions; amounts are the plan's minor units (JPY: yen, USD: cents) unless said otherwise.
import { calculatePlanAmounts } from "./plan-calculation.ts";

export type RuleCurrency = "JPY" | "USD";
export type RulePlan = {
  currency: RuleCurrency; monthlyLivingCost: number; reserveMonths: number; nearTermExpense: number;
  financialAssets: number | null; investedAmount: number | null; tolerancePct: number | null; buyBudgetPct: number | null;
  toleranceDrop: number | null; perStockCapPct: number; buyLines: { dropPct: number; amount: number }[];
};
export type RuleFacts = {
  currency: RuleCurrency; scale: number; monthlyLivingCost: number; toleranceDrop: number | null; tolerancePct: number | null;
  perStockCapPct: number; capAmount: number | null; buyLines: { dropPct: number; amount: number }[];
};

/** Money in major units (yen, dollars), as the simulation shows it: 「90万円」「1万2,345円」 in Japanese yen. */
export function formatMoney(value: number, currency: RuleCurrency, en: boolean): string {
  if (!en && currency === "JPY") {
    const n = Math.floor(value), m = Math.floor(n / 10000), r = n % 10000;
    return n >= 10000 ? (r ? `${m.toLocaleString("ja-JP")}万${r.toLocaleString("ja-JP")}円` : `${m.toLocaleString("ja-JP")}万円`) : `${n.toLocaleString("ja-JP")}円`;
  }
  return new Intl.NumberFormat(en ? "en-US" : "ja-JP", { style: "currency", currency, maximumFractionDigits: currency === "JPY" ? 0 : 2 }).format(value);
}

/** The single-stock cap as an amount: the same base as the diagnosis result (lib/resolute/diagnosis.ts perStockCapAmount). */
export function ruleFacts(plan: RulePlan): RuleFacts {
  let capAmount: number | null = null;
  try {
    const { investBase } = calculatePlanAmounts({ currency: plan.currency, monthlyLivingCost: plan.monthlyLivingCost, reserveMonths: plan.reserveMonths,
      nearTermExpense: plan.nearTermExpense, financialAssets: plan.financialAssets, investedAmount: plan.investedAmount,
      tolerancePct: plan.tolerancePct, buyBudgetPct: plan.buyBudgetPct });
    if (investBase !== null && investBase > 0 && Number.isFinite(plan.perStockCapPct))
      capAmount = Math.floor((investBase * Math.round(plan.perStockCapPct * 10)) / 1000);
  } catch { capAmount = null; }
  return { currency: plan.currency, scale: plan.currency === "USD" ? 100 : 1, monthlyLivingCost: plan.monthlyLivingCost,
    toleranceDrop: plan.toleranceDrop, tolerancePct: plan.tolerancePct, perStockCapPct: plan.perStockCapPct, capAmount,
    buyLines: plan.buyLines.map(l => ({ dropPct: l.dropPct, amount: l.amount })) };
}

/** Within / exactly at / over the loss limit. `loss` and `limit` in major units; exact means nothing is left (owner, Nov 25). */
export function toleranceVerdict(loss: { lossAmount: number; withinTolerance: boolean }, limit: number, currency: RuleCurrency): "exact" | "within" | "over" {
  if (!loss.withinTolerance) return "over";
  const scale = currency === "USD" ? 100 : 1;
  return Math.round(limit * scale) - Math.round(loss.lossAmount * scale) <= 0 ? "exact" : "within";
}

export type GaugeMark = { kind: "buy" | "tolerance"; pct: number; amount?: number; at: number; labelAt: number };
export type DropGauge = { max: number; ticks: number[]; fill: number; marks: GaugeMark[] };
/** The ② drop gauge (PC): 0% at the top to −50% at the bottom, longer when the drop or a line goes past −50% (owner, Nov 25).
 * Positions are 0..1 from the top. Labels keep `gap` apart and stay inside 0..1, so nothing leaves the panel. */
export function dropGauge(drop: number, buyLines: { dropPct: number; amount: number }[], tolerancePct: number | null, gap = 0.1): DropGauge {
  const deepest = Math.max(50, drop, ...buyLines.map(l => l.dropPct), tolerancePct !== null && tolerancePct <= 100 ? tolerancePct : 0);
  const max = Math.min(100, Math.ceil(deepest / 10) * 10);
  const step = max > 50 ? (max > 80 ? 20 : 10) : 10;
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  const at = (pct: number) => Math.min(1, Math.max(0, pct / max));
  const marks: GaugeMark[] = buyLines.filter(l => l.dropPct > 0 && l.dropPct <= max).map(l => ({ kind: "buy" as const, pct: l.dropPct, amount: l.amount, at: at(l.dropPct), labelAt: at(l.dropPct) }));
  if (tolerancePct !== null && tolerancePct > 0 && tolerancePct <= max) marks.push({ kind: "tolerance", pct: tolerancePct, at: at(tolerancePct), labelAt: at(tolerancePct) });
  marks.sort((a, b) => a.at - b.at || (a.kind === "buy" ? -1 : 1));
  const g = Math.min(gap, marks.length > 1 ? 1 / (marks.length - 1) : gap);
  for (let i = 1; i < marks.length; i++) marks[i].labelAt = Math.max(marks[i].labelAt, marks[i - 1].labelAt + g);
  if (marks.length && marks[marks.length - 1].labelAt > 1) {
    marks[marks.length - 1].labelAt = 1;
    for (let i = marks.length - 2; i >= 0; i--) marks[i].labelAt = Math.min(marks[i].labelAt, marks[i + 1].labelAt - g);
  }
  for (const m of marks) m.labelAt = Math.min(1, Math.max(0, m.labelAt));
  return { max, ticks, fill: at(Math.min(drop, max)), marks };
}

export type CapBar = { name: string; valueAfter: number; width: number; over: number };
/** The ② rise check, the one used by the phone and the PC (owner, Nov 25): each holding after the rise against the single-stock
 * cap as an amount (major units), the same amount as the diagnosis result. Without an amount (no invested amount in the plan)
 * the cap is that share of the total after the rise. `overNames` are the holdings above the cap. */
export function capBars(items: { name: string; valueAfter: number }[], capAmount: number | null, capPct: number) {
  const total = items.reduce((s, i) => s + i.valueAfter, 0);
  const cap = capAmount ?? Math.floor(total * capPct) / 100;
  const top = Math.max(cap, ...items.map(i => i.valueAfter));
  const span = top > 0 ? top / 0.85 : 1;
  const bars: CapBar[] = items.map(i => ({ name: i.name, valueAfter: i.valueAfter, width: Math.min(1, i.valueAfter / span), over: Math.max(0, i.valueAfter - cap) }));
  return { cap, capAt: Math.min(1, cap / span), bars, overNames: bars.filter(b => b.over > 1e-9).map(b => b.name) };
}
