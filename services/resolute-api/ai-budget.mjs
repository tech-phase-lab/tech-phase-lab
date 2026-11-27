import {riskDate} from '../../lib/resolute/risk.ts';
// Shared by news summaries and RIZEL selection. Calendar month: Asia/Tokyo.
// Use an independently committing pool, never the article transaction client:
// rolling back an article must not roll back an already incurred API cost.
export const AI_REQUEST_RESERVATION_USD=0.10;
export function monthlyAiLimit(raw=process.env.RESOLUTE_AI_MONTHLY_LIMIT_USD){
 if(typeof raw!=='string'||!/^\d(?:\.\d{1,2})?$/.test(raw))throw Error('AI_BUDGET_NOT_CONFIGURED');
 const limit=Number(raw);if(limit<=0||limit>5)throw Error('AI_BUDGET_NOT_CONFIGURED');return limit;
}
/** Per-request caps, so the 10-cent reservation always bounds one request. GPT-5.4 mini: $0.75/M input, $4.50/M output.
 * Worst case at the caps: 64,000 bytes of input (at most 64,000 tokens) = $0.048, plus 4,000 output tokens = $0.018: $0.066 < $0.10.
 * Raised from 1,800 output tokens on Nov 28 for the Shock Gauge ranking (20 ranked items with a Japanese and an English reason,
 * about 2,400 tokens; it asked for 2,500 and every attempt was refused). The monthly cap (monthlyAiLimit) is unchanged. */
export const MAX_REQUEST_BYTES=64000,MAX_OUTPUT_TOKENS=4000;
export function serializeBudgetedRequest(body){
 if(body.model!=='gpt-5.4-mini'||body.tools?.length||body.service_tier||!Number.isInteger(body.max_output_tokens)||body.max_output_tokens<1||body.max_output_tokens>MAX_OUTPUT_TOKENS)throw Error('AI_REQUEST_OUTSIDE_BUDGET');
 const serialized=JSON.stringify(body);if(Buffer.byteLength(serialized,'utf8')>MAX_REQUEST_BYTES)throw Error('AI_REQUEST_OUTSIDE_BUDGET');return serialized;
}
/** 「今日やること」 (one call per member per day) has its own monthly bucket and limit, so the daily member job can never use up
 * the news summaries' five dollars (or the reverse). Same model, prices, reservation and settlement rules. */
export const TODAY_PLAN_RESERVATION_USD=0.02;
export function todayPlanMonthlyLimit(raw=process.env.RESOLUTE_TODAY_PLAN_MONTHLY_LIMIT_USD){
 if(typeof raw!=='string'||!/^\d{1,3}(?:\.\d{1,2})?$/.test(raw))throw Error('AI_BUDGET_NOT_CONFIGURED');
 const limit=Number(raw);if(limit<=0||limit>300)throw Error('AI_BUDGET_NOT_CONFIGURED');return limit;
}
const BUDGET_TABLES=new Set(['risk_budget','today_plan_budget']);
export async function reserveAiSpend(pool,now=new Date(),{table='risk_budget',limit,reserve=AI_REQUEST_RESERVATION_USD}={}){
 if(!BUDGET_TABLES.has(table))throw Error('AI_BUDGET_NOT_CONFIGURED');
 limit??=monthlyAiLimit();const month=riskDate(now).slice(0,7);
 if(reserve>limit)throw Error('BUDGET_LIMIT');
 const result=await pool.query(`INSERT INTO resolute.${table}(month,reserved_usd) VALUES($1,$2)
 ON CONFLICT(month) DO UPDATE SET reserved_usd=resolute.${table}.reserved_usd+$2
 WHERE resolute.${table}.reserved_usd+$2<=$3 RETURNING reserved_usd`,[month,reserve,limit]);
 if(!result.rows.length)throw Error('BUDGET_LIMIT');
 let settled=false;
 return async usage=>{
  // Unknown/failed/interrupted calls keep the full reservation. Never retry free.
  if(settled)return;settled=true;
  if(!usage||!Number.isSafeInteger(usage.input_tokens)||usage.input_tokens<0||!Number.isSafeInteger(usage.output_tokens)||usage.output_tokens<0)return;
  const actual=Math.ceil((usage.input_tokens*.75+usage.output_tokens*4.5)/100)/10000;
  if(actual<=0||actual>reserve)return;
  await pool.query(`UPDATE resolute.${table} SET reserved_usd=GREATEST(0,reserved_usd-$2) WHERE month=$1`,[month,Number((reserve-actual).toFixed(4))]);
 };
}
