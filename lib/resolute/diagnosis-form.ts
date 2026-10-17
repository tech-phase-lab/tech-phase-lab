import { scaledNumberInput } from "./number-input.ts";
import { QUESTIONS_JA } from "./diagnosis-questions-ja.ts";
import { EN_QUESTIONS, type DiagnosisLocale } from "./diagnosis-copy.ts";
import { emptyPlanAnswers, parsePlanAnswers, type PlanAnswers, type PlanQuestionId } from "./plan-answers.ts";
import { parsePlan, type PlanInput } from "./plan-data.ts";
import { diagnose, type DiagnosisInput } from "./diagnosis.ts";
export type Question = { id: PlanQuestionId; s: string; text: string; note?: string; multi?: boolean;
 free?: "noBuyConditions" | "haltConditions"; field?: string;
 o: { id: string; label: string; val?: number|null; input?: { unit: string; mult: number; step?: number; label?: string } }[] };
export const questions: Question[] = JSON.parse(JSON.stringify(QUESTIONS_JA));
export type DiagnosisDraft = { currency: "JPY"|"USD"; answers: PlanAnswers; numbers: Partial<Record<PlanQuestionId,string>>;
 stopLossPct?: number|null; noBuyConditions: string[]; haltConditions: string[]; fx: PlanInput["fx"] };
export function emptyDiagnosisDraft(): DiagnosisDraft {
 return { currency: "JPY", answers: emptyPlanAnswers(), numbers: {}, noBuyConditions: [], haltConditions: [],
  fx: { thresholdYen: null, usdJpy: null, note: "" } };
}
export function isQuestionVisible(id: PlanQuestionId, a: PlanAnswers) {
 if (id === "q21") return a.q20 === "stock" || a.q20 === "mixed";
 if (id === "q25" || id === "q26") return a.q24 !== null && a.q24 !== "none";
 if (id === "q27") return ["steps2","steps3","steps4"].includes(a.q24 ?? "");
 return true;
}
export function selectAnswer(d: DiagnosisDraft, id: PlanQuestionId, value: string | string[] | null): DiagnosisDraft {
 const answers = { ...d.answers, [id]: value };
 for (const q of questions) if (!isQuestionVisible(q.id, answers)) Object.assign(answers, { [q.id]: null });
 const numbers = { ...d.numbers };
 for (const q of questions) if (!isQuestionVisible(q.id, answers)) delete numbers[q.id];
 return { ...d, answers: parsePlanAnswers(answers), numbers };
}
export function questionCopy(q: Question, locale: DiagnosisLocale, currency: "JPY"|"USD" = "JPY") {
 const en = EN_QUESTIONS[q.id];
 return { text: locale === "en" ? en.text : q.text, note: locale === "en" ? en.note : q.note,
  options: q.o.map((o,index) => ({ ...o, label: locale === "en" ? en.options[index] :
   q.id === "q06" && o.id === "has" ? "ある（金額を入力する）" : q.id === "q30" && o.id === "custom" ? "入力する" : o.label })).filter(o=>currency!=="USD" || q.id!=="q02" || o.id==="custom") };
}
export function numericLimits(q: Question, answers: PlanAnswers, currency: "JPY"|"USD" = "JPY") {
 const money = ["q02","q06","q07","q08"].includes(q.id);
 const steps = Number(answers.q24?.match(/^steps([234])$/)?.[1] ?? 1);
 return { min: q.id === "q25" || q.id === "q30" ? 0.1 : 0,
  max: money ? (currency === "USD" ? 1e10 : 1e12) : q.id === "q04" ? 600 : q.id === "q05" ? 120 : q.id === "q30" ? 50 : q.id === "q25" ? Math.floor(999 / steps) / 10 : 100,
  step: money ? (currency === "USD" ? 0.01 : 1) : 0.1, money };
}
export function numericAnswer(q: Question, d: DiagnosisDraft): number | null {
 const option = q.o.find(o => o.id === d.answers[q.id]);
 if (!option) throw new Error("ANSWER_REQUIRED");
 if (!option.input) { if (d.currency === "USD" && q.id === "q02") throw new Error("USD_AMOUNT_REQUIRED"); return option.val ?? null; }
 const text = d.numbers[q.id] ?? "";
 if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("INVALID_NUMBER");
 const value = Number(text), limits = numericLimits(q,d.answers,d.currency);
 if (!Number.isFinite(value) || value < limits.min || value > limits.max ||
   (limits.money ? (d.currency === "USD" ? !/^\d+(?:\.\d{1,2})?$/.test(text) : !Number.isSafeInteger(value)) : Math.round(value * 10) / 10 !== value)) throw new Error("INVALID_NUMBER");
 if(limits.money && d.currency === "USD") { const cents=scaledNumberInput(text,2); if(cents===null)throw new Error("INVALID_NUMBER"); return cents; }
 return value;
}
export function validateQuestion(q: Question,d: DiagnosisDraft): void {
 if (!isQuestionVisible(q.id,d.answers)) return;
 if (!q.multi && d.answers[q.id] === null) throw new Error("ANSWER_REQUIRED");
 if (q.field) numericAnswer(q,d);
 if (q.free && (d[q.free].length > 10 || d[q.free].some(x => [...x].length > 100 || !x.isWellFormed() || x.includes("\u0000")))) throw new Error("INVALID_TEXT");
}
export function draftToInput(d: DiagnosisDraft): DiagnosisInput {
 questions.forEach(q => validateQuestion(q,d));
 const get = (id: PlanQuestionId) => isQuestionVisible(id,d.answers) ? numericAnswer(questions.find(q => q.id === id)!,d) : null;
 return { currency: d.currency, answers: parsePlanAnswers(d.answers), monthlyLivingCost: get("q02")!, savingsMonths: get("q04"),
 reserveMonths: get("q05")!, nearTermExpense: get("q06")!, financialAssets: get("q07"), investedAmount: get("q08"),
 tolerancePct: get("q11"), perStockCapPct: get("q22")!, firstDropPct: get("q25"), buyBudgetPct: get("q26"),
 noBuyConditions: d.noBuyConditions.filter(x=>x.trim()), haltConditions: d.haltConditions.filter(x=>x.trim()),
 fx: { thresholdYen: get("q30") } };
}
export function draftToPlan(d: DiagnosisDraft): PlanInput {
 const i = draftToInput(d), r = diagnose(i), a = d.answers;
 return parsePlan({ ...(d.stopLossPct === undefined ? {} : {stopLossPct:d.stopLossPct}), schemaVersion: 1, answersVersion: 1, answers: a, currency: d.currency,
 monthlyLivingCost: i.monthlyLivingCost, savingsMonths: i.savingsMonths, reserveMonths: i.reserveMonths,
 nearTermExpense: i.nearTermExpense, financialAssets: i.financialAssets, investedAmount: i.investedAmount,
 investable: r.amounts.investable, tolerancePct: i.tolerancePct, toleranceDrop: r.amounts.toleranceDrop,
 perStockCapPct: i.perStockCapPct, firstDropPct: i.firstDropPct,
 buyMode: a.q24 === "none" ? "none" : a.q24 === "single" ? "single" : "steps", buyLines: r.buyLines,
 buyBudgetPct: i.buyBudgetPct, allocation: a.q27, noBuyConditions: i.noBuyConditions, haltConditions: i.haltConditions,
 fx: { ...d.fx, thresholdYen: i.fx!.thresholdYen }, ruleType: "undecided" });
}
export function draftFromPlan(p: PlanInput): DiagnosisDraft {

 const d: DiagnosisDraft = { ...(p.stopLossPct === undefined ? {} : {stopLossPct:p.stopLossPct}), currency: p.currency, answers: structuredClone(p.answers), numbers: {},
 noBuyConditions: [...p.noBuyConditions], haltConditions: [...p.haltConditions], fx: { ...p.fx } };
 const values: Record<string,unknown> = { ...p, thresholdYen: p.fx.thresholdYen,
 firstDropPct: p.firstDropPct ?? p.buyLines[0]?.dropPct ?? null };
 for (const q of questions) {
  const v = q.field ? values[q.field] : null;
  if (typeof v === "number") d.numbers[q.id] = String(p.currency === "USD" && numericLimits(q,p.answers).money ? v / 100 : v);
 }
 if(p.currency === "USD") d.answers.q02="custom";
 return d;
}
