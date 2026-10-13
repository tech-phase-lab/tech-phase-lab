import { buildResultRows, calcAmounts, diagnose, type DiagnosisInput } from "./diagnosis.ts";
import { localizeDiagnosis, type DiagnosisLocale } from "./diagnosis-copy.ts";
import { calculatePlanAmounts } from "./plan-calculation.ts";
import { parsePlan, type PlanInput, type PlanSnapshot } from "./plan-data.ts";
/** Read the saved plan itself, never rebuild its custom purchase lines from quiz answers. */
export function notebookResult(plan: PlanInput, locale: DiagnosisLocale) {
 const input: DiagnosisInput = {...plan, firstDropPct:plan.firstDropPct ?? plan.buyLines[0]?.dropPct ?? null};
 const result=diagnose(input), amounts=calcAmounts(input);
 return localizeDiagnosis({...result,amounts,buyLines:plan.buyLines,rows:buildResultRows(input,amounts,plan.buyLines)},input,locale);
}
export type NotebookEdits = { reserveMonths:string; perStockCapPct:string; noBuyConditions:string; haltConditions:string };
export function notebookEdits(plan:PlanInput):NotebookEdits {
 return {reserveMonths:String(plan.reserveMonths),perStockCapPct:String(plan.perStockCapPct),noBuyConditions:plan.noBuyConditions.join("\n"),haltConditions:plan.haltConditions.join("\n")};
}
export function adjustNotebook(plan:PlanInput, edits:NotebookEdits):PlanInput {
 const decimal=(value:string)=>{if(!/^\d+(?:\.\d)?$/.test(value))throw new Error("INVALID_NUMBER");return Number(value);};
 const {createdAt:_createdAt,updatedAt:_updatedAt,...input}=plan as PlanSnapshot["plan"] & PlanInput;
 void _createdAt;void _updatedAt;
 const next={...input,reserveMonths:decimal(edits.reserveMonths),perStockCapPct:decimal(edits.perStockCapPct),
  noBuyConditions:edits.noBuyConditions.split("\n").filter(x=>x.trim()),haltConditions:edits.haltConditions.split("\n").filter(x=>x.trim()),answers:{...plan.answers}};
 if(next.reserveMonths!==plan.reserveMonths)next.answers.q05="custom";
 if(next.perStockCapPct!==plan.perStockCapPct)next.answers.q22="custom";
 const {currency,monthlyLivingCost,reserveMonths,nearTermExpense,financialAssets,investedAmount,tolerancePct,buyBudgetPct}=next;
 const amounts=calculatePlanAmounts({currency,monthlyLivingCost,reserveMonths,nearTermExpense,financialAssets,investedAmount,tolerancePct,buyBudgetPct});
 return parsePlan({...next,investable:amounts.investable,toleranceDrop:amounts.toleranceDrop});
}
const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
/** Portable, script-free copy. User text is escaped; no external fonts, links or requests. */
export function notebookDocument(plan:NonNullable<PlanSnapshot["plan"]>,locale:DiagnosisLocale):string {
 const result=notebookResult(plan,locale),en=locale==="en",title=en?"My investing rulebook":"私の投資ルール";
 return `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>RESOLUTE — ${title}</title><style>body{margin:0;background:#0a1018;color:#eee9df;font:16px/1.9 Georgia,serif}main{max-width:660px;margin:40px auto;padding:48px 30px;border:1px solid #ad8b4f;border-left:8px solid #ad8b4f;background:#121c29}header{text-align:center;padding:20px 0 40px;border-bottom:1px solid #ad8b4f}small,dt{color:#d8b36a}h1{font-weight:400;letter-spacing:.08em}dl>div{padding:24px 0;border-bottom:1px solid #39404a}dd{margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}footer{font-size:12px;margin-top:40px;color:#b6b5b1}@media print{body,main{background:white;color:#17202b}main{margin:0;border:0}dl>div{break-inside:avoid}}</style><main><header><small>RESOLUTE · PERSONAL RULEBOOK · ${plan.currency}</small><h1>${title}</h1><p>${escape(result.typeName)}</p><small>${en?"Saved":"保存日"} ${escape(plan.updatedAt.slice(0,10))}</small></header><dl>${result.rows.map(row=>`<div><dt>${escape(row.item)}</dt><dd>${escape(row.rule)}</dd></div>`).join("")}</dl><footer>${escape(result.disclaimer)}<br>${en?"This is a saved copy. Later changes will not update this file. Contains your financial information; keep it somewhere private.":"保存時点の写しです。後の変更はこのファイルに反映されません。資産情報を含むため自分だけが開ける場所に保管してください。"}</footer></main></html>`;
}
