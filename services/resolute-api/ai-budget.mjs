import {riskDate} from '../../lib/resolute/risk.ts';
// Shared by news summaries and RIZEL selection. Calendar month: Asia/Tokyo.
// Use an independently committing pool, never the article transaction client:
// rolling back an article must not roll back an already incurred API cost.
export const AI_REQUEST_RESERVATION_USD=0.10;
export function monthlyAiLimit(raw=process.env.RESOLUTE_AI_MONTHLY_LIMIT_USD){
 if(typeof raw!=='string'||!/^\d(?:\.\d{1,2})?$/.test(raw))throw Error('AI_BUDGET_NOT_CONFIGURED');
 const limit=Number(raw);if(limit<=0||limit>5)throw Error('AI_BUDGET_NOT_CONFIGURED');return limit;
}
export function serializeBudgetedRequest(body){
 // Restrict model, tools and size so the 10-cent reservation bounds a request.
 // GPT-5.4 mini: $0.75/M input, $4.50/M output; 64KB + framing < $0.10.
 if(body.model!=='gpt-5.4-mini'||body.tools?.length||body.service_tier||!Number.isInteger(body.max_output_tokens)||body.max_output_tokens<1||body.max_output_tokens>1800)throw Error('AI_REQUEST_OUTSIDE_BUDGET');
 const serialized=JSON.stringify(body);if(Buffer.byteLength(serialized,'utf8')>64000)throw Error('AI_REQUEST_OUTSIDE_BUDGET');return serialized;
}
export async function reserveAiSpend(pool,now=new Date()){
 const limit=monthlyAiLimit(),month=riskDate(now).slice(0,7),reserve=AI_REQUEST_RESERVATION_USD;
 if(reserve>limit)throw Error('BUDGET_LIMIT');
 const result=await pool.query(`INSERT INTO resolute.risk_budget(month,reserved_usd) VALUES($1,$2)
 ON CONFLICT(month) DO UPDATE SET reserved_usd=resolute.risk_budget.reserved_usd+$2
 WHERE resolute.risk_budget.reserved_usd+$2<=$3 RETURNING reserved_usd`,[month,reserve,limit]);
 if(!result.rows.length)throw Error('BUDGET_LIMIT');
 let settled=false;
 return async usage=>{
  // Unknown/failed/interrupted calls keep the full reservation. Never retry free.
  if(settled)return;settled=true;
  if(!usage||!Number.isSafeInteger(usage.input_tokens)||usage.input_tokens<0||!Number.isSafeInteger(usage.output_tokens)||usage.output_tokens<0)return;
  const actual=Math.ceil((usage.input_tokens*.75+usage.output_tokens*4.5)/100)/10000;
  if(actual<=0||actual>reserve)return;
  await pool.query('UPDATE resolute.risk_budget SET reserved_usd=GREATEST(0,reserved_usd-$2) WHERE month=$1',[month,Number((reserve-actual).toFixed(4))]);
 };
}
