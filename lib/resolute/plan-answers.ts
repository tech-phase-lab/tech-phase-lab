/** Questionnaire storage contract only. No investor type or advice classification. */
export const PLAN_ANSWER_OPTIONS = {
  q01: ["first", "1to3", "3to5", "5to7", "7to10", "10plus"],
  q02: ["l15", "l25", "l40", "l40plus", "custom"],
  q03: ["stable", "uneven", "none"],
  q04: ["m0", "m1", "m3", "m6", "m12", "custom"],
  q05: ["m3", "m6", "m12", "custom"],
  q06: ["none", "has"], q07: ["input", "unknown"], q08: ["not_yet", "input"],
  q09: ["y3to5", "y5to10", "y10plus", "undecided"],
  q10: ["often", "sometimes", "rarely", "no_drop_yet"],
  q11: ["p10", "p20", "p30", "p40plus", "unknown"],
  q12: ["no", "yes", "no_drop_yet"], q13: ["wait", "buy_more", "reduce", "unknown"],
  q14: ["never", "once", "often", "no_rally_yet"], q15: ["hold", "sell_some", "buy_more", "undecided"],
  q16: ["steady", "fast", "defensive", "undecided"],
  q17: ["monthly", "on_drop", "on_rise", "news", "undecided"],
  q18: ["many_daily", "daily", "weekly", "rarely"], q19: ["never", "sometimes", "often"],
  q20: ["fund_etf", "stock", "bond", "gold", "mixed"],
  q21: ["tech_semis", "dividend", "healthcare", "finance", "energy_materials", "other"],
  q22: ["p10", "p20", "p30", "p50", "custom"], q23: ["lt10", "p10to30", "p30to50", "gt50", "none"],
  q24: ["none", "single", "steps2", "steps3", "steps4"],
  q25: ["d5", "d10", "d15", "d20", "unknown", "custom"], q26: ["b5", "b10", "b20", "b30", "custom"],
  q27: ["equal", "heavier"], q28: ["cash_low", "income_unstable", "over_cap", "no_reason"],
  q29: ["over_tolerance", "cant_sleep", "thesis_broken"], q30: ["ignore", "yen3", "yen7", "custom"],
} as const;
export type PlanQuestionId = keyof typeof PLAN_ANSWER_OPTIONS;
type MultipleQuestionId = "q21" | "q28" | "q29";
export type PlanAnswers = { [K in PlanQuestionId]: K extends MultipleQuestionId
  ? (typeof PLAN_ANSWER_OPTIONS)[K][number][] | null : (typeof PLAN_ANSWER_OPTIONS)[K][number] | null };
const ids = Object.keys(PLAN_ANSWER_OPTIONS) as PlanQuestionId[];
const multiple = new Set<PlanQuestionId>(["q21", "q28", "q29"]);
export function emptyPlanAnswers(): PlanAnswers {
  return Object.fromEntries(ids.map(id => [id, null])) as PlanAnswers;
}
export function parsePlanAnswers(value: unknown): PlanAnswers {
  const invalid = () => { throw new Error("INVALID_PLAN_ANSWERS"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== ids.length || !ids.every(id => Object.hasOwn(v, id))) return invalid();
  for (const id of ids) {
    const answer = v[id]; if (answer === null) continue;
    const allowed: readonly string[] = PLAN_ANSWER_OPTIONS[id];
    if (multiple.has(id)) {
      if (!Array.isArray(answer) || answer.length === 0 || answer.length > allowed.length ||
        new Set(answer).size !== answer.length || !answer.every(a => typeof a === "string" && allowed.includes(a))) return invalid();
    } else if (typeof answer !== "string" || !allowed.includes(answer)) return invalid();
  }
  if (!(v.q20 === "stock" || v.q20 === "mixed") && v.q21 !== null) return invalid();
  const buying = ["single", "steps2", "steps3", "steps4"].includes(v.q24 as string);
  const steps = ["steps2", "steps3", "steps4"].includes(v.q24 as string);
  if (!buying && (v.q25 !== null || v.q26 !== null) || !steps && v.q27 !== null) return invalid();
  return JSON.parse(JSON.stringify(v)) as PlanAnswers;
}
export type PlanFx = { thresholdYen: number | null; usdJpy: number | null; note: string };
export function parsePlanFx(value: unknown): PlanFx {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_PLAN_FX");
  const v = value as Record<string, unknown>;
  const decimal = (n: unknown, min: number, max: number, scale: number) => typeof n === "number" &&
    Number.isFinite(n) && n >= min && n <= max && Math.round(n * scale) / scale === n;
  if (Object.keys(v).length !== 3 || !["thresholdYen", "usdJpy", "note"].every(k => Object.hasOwn(v, k)) ||
    !(v.thresholdYen === null || decimal(v.thresholdYen, 0.1, 50, 10)) ||
    !(v.usdJpy === null || decimal(v.usdJpy, 50, 500, 100)) ||
    typeof v.note !== "string" || !v.note.isWellFormed() || v.note.includes("\u0000") || [...v.note].length > 200) throw new Error("INVALID_PLAN_FX");
  return { thresholdYen: v.thresholdYen as number | null, usdJpy: v.usdJpy as number | null, note: v.note };
}
