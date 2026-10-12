import { assertPlanCalculatedAmounts, type PlanCalculationInput } from "./plan-calculation.ts";

import { parsePlanAnswers, parsePlanFx, type PlanAnswers, type PlanFx } from "./plan-answers.ts";

export type PlanInput = PlanCalculationInput & {
  schemaVersion: 1; answersVersion: 1; answers: PlanAnswers; fx: PlanFx; savingsMonths: number | null; investable: number | null;
  toleranceDrop: number | null; perStockCapPct: number;
  buyMode: "none" | "single" | "steps";
  firstDropPct?: number | null;
  buyLines: { dropPct: number; amount: number }[];
  allocation: "equal" | "heavier" | null;
  noBuyConditions: string[]; haltConditions: string[];
  ruleType: "wait" | "scale_in" | "defend" | "undecided";
};
export type PlanSnapshot = { plan: (PlanInput & { createdAt: string; updatedAt: string }) | null; revision: number };
export class PlanInputError extends Error { constructor() { super("INVALID_PLAN"); } }
const keys = ["schemaVersion", "answersVersion", "answers", "fx", "currency", "monthlyLivingCost", "savingsMonths", "reserveMonths",
  "nearTermExpense", "financialAssets", "investedAmount", "investable", "tolerancePct", "toleranceDrop",
  "perStockCapPct", "buyMode", "buyLines", "buyBudgetPct", "allocation", "noBuyConditions", "haltConditions", "ruleType"];
export function exactKeys(v: unknown, names: string[]): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) &&
    Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
}
export function validRevision(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v < Number.MAX_SAFE_INTEGER;
}
const decimal = (v: unknown, max: number) => typeof v === "number" && Number.isFinite(v) &&
  v >= 0 && v <= max && Math.round(v * 10) / 10 === v;
const conditions = (v: unknown) => Array.isArray(v) && v.length <= 10 &&
  v.every(s => typeof s === "string" && s.isWellFormed() && !s.includes("\u0000") && [...s].length <= 100);
export function parsePlan(v: unknown): PlanInput {
  if (!exactKeys(v, v && typeof v === "object" && Object.hasOwn(v, "firstDropPct") ? [...keys, "firstDropPct"] : keys) || v.schemaVersion !== 1 || v.answersVersion !== 1) throw new PlanInputError();
  try {
    const answers = parsePlanAnswers(v.answers);
    const fx = parsePlanFx(v.fx);
    if (answers.q07 === "unknown" && v.financialAssets !== null ||
      answers.q08 === "not_yet" && v.investedAmount !== null ||
      (answers.q25 === "unknown" || answers.q24 === "none") && v.firstDropPct != null ||
      answers.q30 === "ignore" && fx.thresholdYen !== null ||
      answers.q30 === "yen3" && fx.thresholdYen !== 3 ||
      answers.q30 === "yen7" && fx.thresholdYen !== 7 ||
      answers.q30 === "custom" && fx.thresholdYen === null) throw new PlanInputError();
    assertPlanCalculatedAmounts({ currency: v.currency, monthlyLivingCost: v.monthlyLivingCost,
      reserveMonths: v.reserveMonths, nearTermExpense: v.nearTermExpense, financialAssets: v.financialAssets,
      investedAmount: v.investedAmount, tolerancePct: v.tolerancePct, buyBudgetPct: v.buyBudgetPct },
    { investable: v.investable, toleranceDrop: v.toleranceDrop });
  } catch { throw new PlanInputError(); }
  if (!(v.savingsMonths === null || decimal(v.savingsMonths, 600)) || !decimal(v.perStockCapPct, 100) ||
    !conditions(v.noBuyConditions) || !conditions(v.haltConditions) ||
    !["wait", "scale_in", "defend", "undecided"].includes(v.ruleType as string) || !Array.isArray(v.buyLines))
    throw new PlanInputError();
  const lines = v.buyLines;
  if (Object.hasOwn(v, "firstDropPct") && !(v.firstDropPct === null ||
    decimal(v.firstDropPct, 99.9) && (v.firstDropPct as number) > 0)) throw new PlanInputError();
  if (Object.hasOwn(v, "firstDropPct") && lines.length && v.firstDropPct !== lines[0]?.dropPct)
    throw new PlanInputError();
  if (lines.length > 10 || !lines.every((line, i) => exactKeys(line, ["dropPct", "amount"]) &&
    decimal(line.dropPct, 99.9) && (line.dropPct as number) > 0 &&
    typeof line.amount === "number" && Number.isSafeInteger(line.amount) && line.amount >= 0 && line.amount <= 1e12 &&
    (i === 0 || lines[i - 1].dropPct < (line.dropPct as number)))) throw new PlanInputError();
  // An unanswered threshold or unknown budget leaves the chosen mode pending, never a fabricated line.
  const answers = parsePlanAnswers(v.answers);
  const pendingLines = lines.length === 0 && (answers.q25 === null || answers.q25 === "unknown" ||
    v.buyBudgetPct === null || (v.financialAssets === null && (v.investedAmount === null || v.investedAmount === 0)));
  if (!(v.buyMode === "none" && lines.length === 0 && v.buyBudgetPct === null && v.allocation === null ||
    v.buyMode === "single" && (lines.length === 1 || pendingLines) && v.allocation === null ||
    v.buyMode === "steps" && (lines.length >= 2 || pendingLines) && ["equal", "heavier"].includes(v.allocation as string)))
    throw new PlanInputError();
  // Build an isolated JSON copy; never retain references or accept server timestamps or extra private fields.
  return JSON.parse(JSON.stringify(v)) as PlanInput;
}
export function parsePlanMutation(method: "PUT" | "DELETE", v: unknown) {
  if (!exactKeys(v, method === "PUT" ? ["plan", "baseRevision"] : ["baseRevision"]) ||
      !validRevision(v.baseRevision)) throw new PlanInputError();
  return { baseRevision: v.baseRevision, plan: method === "PUT" ? parsePlan(v.plan) : null };
}
export function parsePlanSnapshot(v: unknown): PlanSnapshot {
  if (!exactKeys(v, ["plan", "revision"]) || !validRevision(v.revision)) throw new PlanInputError();
  if (v.plan === null) return { plan: null, revision: v.revision };
  const p = v.plan as Record<string, unknown>;
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new PlanInputError();
  for (const key of ["createdAt", "updatedAt"]) {
    const d = p[key];
    if (typeof d !== "string" || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString() !== d)
      throw new PlanInputError();
  }
  if (Date.parse(p.updatedAt as string) < Date.parse(p.createdAt as string) || v.revision === 0)
    throw new PlanInputError();
  const { createdAt, updatedAt, ...payload } = p;
  return { plan: { ...parsePlan(payload), createdAt: createdAt as string, updatedAt: updatedAt as string }, revision: v.revision };
}
