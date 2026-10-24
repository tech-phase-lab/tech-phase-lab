import { emptyDiagnosisDraft, draftToPlan } from "./diagnosis-form.ts";

/** Fictional owner-review fixture. Never used for customer plans or recommendations. */
export function createReviewSamplePlan() {
 const draft = emptyDiagnosisDraft();
 Object.assign(draft.answers, {
  q01:"first",q02:"l25",q03:"stable",q04:"m6",q05:"m6",q06:"none",
  q07:"input",q08:"input",q09:"y10plus",q10:"rarely",q11:"p30",q12:"no",
  q13:"wait",q14:"never",q15:"hold",q16:"steady",q17:"monthly",q18:"weekly",
  q19:"never",q20:"fund_etf",q22:"p10",q23:"none",q24:"steps2",q25:"d10",
  q26:"b20",q27:"equal",q28:["cash_low"],q29:["over_tolerance"],q30:"ignore",
 });
 draft.numbers = {q07:"10000000",q08:"3000000"};
 return draftToPlan(draft);
}
