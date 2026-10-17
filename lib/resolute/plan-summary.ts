import { buildResultRows, calcAmounts, diagnose, type DiagnosisInput } from "./diagnosis.ts";
import { localizeDiagnosis, type DiagnosisLocale } from "./diagnosis-copy.ts";
import type { PlanInput } from "./plan-data.ts";
/** Read the saved plan itself, never rebuild its custom purchase lines from quiz answers. */
export function notebookResult(plan: PlanInput, locale: DiagnosisLocale) {
 const input: DiagnosisInput = {...plan, firstDropPct:plan.firstDropPct ?? plan.buyLines[0]?.dropPct ?? null};
 const result=diagnose(input), amounts=calcAmounts(input);
 return localizeDiagnosis({...result,amounts,buyLines:plan.buyLines,rows:buildResultRows(input,amounts,plan.buyLines)},input,locale);
}
