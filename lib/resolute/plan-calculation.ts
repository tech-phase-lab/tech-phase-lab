/** Agreed calculation inputs only. This is not the full Plan/save API schema. */
export type PlanCalculationInput = {
  currency: "JPY" | "USD";
  monthlyLivingCost: number;
  reserveMonths: number;
  nearTermExpense: number;
  financialAssets: number | null;
  investedAmount: number | null;
  tolerancePct: number | null;
  buyBudgetPct: number | null;
};
export type PlanCalculatedAmounts = {
  reserve: number;
  investable: number | null;
  investBase: number | null;
  toleranceDrop: number | null;
  toleranceMonths: number | null;
  buyBudget: number | null;
};
export class PlanCalculationError extends Error {
  readonly code: "INVALID_CALCULATION_INPUT" | "CALCULATED_AMOUNTS_MISMATCH";
  constructor(code: PlanCalculationError["code"]) { super(code); this.code = code; }
}

const inputKeys = ["currency", "monthlyLivingCost", "reserveMonths", "nearTermExpense",
  "financialAssets", "investedAmount", "tolerancePct", "buyBudgetPct"];
const zero = BigInt(0), ten = BigInt(10), thousand = BigInt(1000);

function money(value: unknown, nullable = false): boolean {
  return (nullable && value === null) || (typeof value === "number" &&
    Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000);
}

function tenths(value: unknown, maximum: number, nullable = false): boolean {
  return (nullable && value === null) || (typeof value === "number" && Number.isFinite(value) &&
    value >= 0 && value <= maximum && Math.round(value * 10) / 10 === value);
}

function input(value: unknown): PlanCalculationInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PlanCalculationError("INVALID_CALCULATION_INPUT");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== inputKeys.length || !inputKeys.every(key => Object.hasOwn(v, key)) ||
      !(v.currency === "JPY" || v.currency === "USD") ||
      !money(v.monthlyLivingCost) || !money(v.nearTermExpense) ||
      !money(v.financialAssets, true) || !money(v.investedAmount, true) ||
      !tenths(v.reserveMonths, 120) || !tenths(v.tolerancePct, 100, true) || !tenths(v.buyBudgetPct, 100, true))
    throw new PlanCalculationError("INVALID_CALCULATION_INPUT");
  return v as PlanCalculationInput;
}

/** Decimal tenths become integer units before multiplication and flooring. No floating money math. */
export function calculatePlanAmounts(value: unknown): PlanCalculatedAmounts {
  const p = input(value);
  const livingCost = BigInt(p.monthlyLivingCost);
  const reserve = livingCost * BigInt(Math.round(p.reserveMonths * 10)) / ten;
  const available = p.financialAssets === null ? null
    : BigInt(p.financialAssets) - reserve - BigInt(p.nearTermExpense);
  const investable = available === null ? null : available > zero ? available : zero;
  const base = p.investedAmount !== null && p.investedAmount > 0 ? BigInt(p.investedAmount) : investable;
  const percentAmount = (pct: number | null) => base === null || pct === null ? null
    : base * BigInt(Math.round(pct * 10)) / thousand;
  const toleranceDrop = percentAmount(p.tolerancePct);
  const buyBudget = percentAmount(p.buyBudgetPct);
  return {
    reserve: Number(reserve), investable: investable === null ? null : Number(investable),
    investBase: base === null ? null : Number(base),
    toleranceDrop: toleranceDrop === null ? null : Number(toleranceDrop),
    toleranceMonths: toleranceDrop === null || livingCost === zero ? null
      : Number(toleranceDrop * ten / livingCost) / 10,
    buyBudget: buyBudget === null ? null : Number(buyBudget),
  };
}

/** Future save handler must recompute; never trust browser-supplied derived amounts. */
export function assertPlanCalculatedAmounts(value: unknown, claimed: unknown): PlanCalculatedAmounts {
  const calculated = calculatePlanAmounts(value);
  const c = claimed && typeof claimed === "object" && !Array.isArray(claimed)
    ? claimed as Record<string, unknown> : {};
  if (Object.keys(c).length !== 2 || c.investable !== calculated.investable || c.toleranceDrop !== calculated.toleranceDrop)
    throw new PlanCalculationError("CALCULATED_AMOUNTS_MISMATCH");
  return calculated;
}
