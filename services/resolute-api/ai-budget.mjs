import {riskDate} from '../../lib/resolute/risk.ts';
// Shared by news summaries and RIZEL selection. Calendar month: Asia/Tokyo.
// Use an independently committing pool, never the article transaction client:
// rolling back an article must not roll back an already incurred API cost.
export const AI_REQUEST_RESERVATION_USD=0.10;
export function monthlyAiLimit(raw=process.env.RESOLUTE_AI_MONTHLY_LIMIT_USD){
 if(typeof raw!=='string'||!/^\d(?:\.\d{1,2})?$/.test(raw))throw Error('AI_BUDGET_NOT_CONFIGURED');
 const limit=Number(raw);if(limit<=0||limit>5)throw Error('AI_BUDGET_NOT_CONFIGURED');return limit;
}
/** The models the budget allows and their list prices (USD per million tokens; cached input is the provider's prompt-cache price,
 * reported as usage.input_tokens_details.cached_tokens). GPT-5.4 nano (Nov 28) writes the Shock Gauge summaries first and the
 * translations; GPT-5.4 mini everything else. */
export const MODEL_PRICES=Object.freeze({
 'gpt-5.4-mini':Object.freeze({input:0.75,cachedInput:0.075,output:4.5}),
 'gpt-5.4-nano':Object.freeze({input:0.2,cachedInput:0.02,output:1.25}),
});
export const DEFAULT_MODEL='gpt-5.4-mini';
/** What one call cost (USD, rounded up to 1/100 cent), from the provider's usage; null when the usage is not readable. */
export function usageCost(usage,model=DEFAULT_MODEL){
 const p=MODEL_PRICES[model]??MODEL_PRICES[DEFAULT_MODEL];
 if(!usage||!Number.isSafeInteger(usage.input_tokens)||usage.input_tokens<0||!Number.isSafeInteger(usage.output_tokens)||usage.output_tokens<0)return null;
 const raw=usage.input_tokens_details?.cached_tokens,cached=Number.isSafeInteger(raw)&&raw>0?Math.min(raw,usage.input_tokens):0;
 return Math.ceil(((usage.input_tokens-cached)*p.input+cached*p.cachedInput+usage.output_tokens*p.output)/100)/10000;
}
/** The most one request can cost: every byte sent counted as an uncached input token (a token is at least one byte), plus a margin
 * for the provider's message framing, plus every output token allowed. Reserved before the call instead of the flat 10 cents, so a
 * failed call (which keeps its reservation) holds only what it could have cost. */
export function requestCostBound(serialized,model,maxOutputTokens){
 const p=MODEL_PRICES[model];if(!p)throw Error('AI_REQUEST_OUTSIDE_BUDGET');
 return Math.max(0.001,Math.ceil(((Buffer.byteLength(serialized,'utf8')+500)*p.input+maxOutputTokens*p.output)/100)/10000);
}
/** Per-request caps, so the 10-cent reservation always bounds one request. GPT-5.4 mini: $0.75/M input, $4.50/M output.
 * Worst case at the caps: 64,000 bytes of input (at most 64,000 tokens) = $0.048, plus 4,000 output tokens = $0.018: $0.066 < $0.10.
 * Raised from 1,800 output tokens on Nov 28 for the Shock Gauge ranking (20 ranked items with a Japanese and an English reason,
 * about 2,400 tokens; it asked for 2,500 and every attempt was refused). The monthly cap (monthlyAiLimit) is unchanged. */
export const MAX_REQUEST_BYTES=64000,MAX_OUTPUT_TOKENS=4000;
export function serializeBudgetedRequest(body){
 if(!Object.hasOwn(MODEL_PRICES,body.model??'')||body.tools?.length||body.service_tier||!Number.isInteger(body.max_output_tokens)||body.max_output_tokens<1||body.max_output_tokens>MAX_OUTPUT_TOKENS)throw Error('AI_REQUEST_OUTSIDE_BUDGET');
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
/** Reserves `reserve` dollars of the month's budget before a call; the returned settle(usage) replaces the reservation with what the
 * call cost (`model`'s prices, cached input at the cached price; a call that cost more than reserved is charged the difference).
 * settle.release() gives the whole reservation back, only for a request the provider refused before doing any work (HTTP 400, 401,
 * 403, 404, 422 or 429: never billed). */
export async function reserveAiSpend(pool,now=new Date(),{table='risk_budget',limit,reserve=AI_REQUEST_RESERVATION_USD,model=DEFAULT_MODEL}={}){
 if(!BUDGET_TABLES.has(table))throw Error('AI_BUDGET_NOT_CONFIGURED');
 limit??=monthlyAiLimit();const month=riskDate(now).slice(0,7);
 if(reserve>limit)throw Error('BUDGET_LIMIT');
 const result=await pool.query(`INSERT INTO resolute.${table}(month,reserved_usd) VALUES($1,$2)
 ON CONFLICT(month) DO UPDATE SET reserved_usd=resolute.${table}.reserved_usd+$2
 WHERE resolute.${table}.reserved_usd+$2<=$3 RETURNING reserved_usd`,[month,reserve,limit]);
 if(!result.rows.length)throw Error('BUDGET_LIMIT');
 let settled=false;
 const settle=async usage=>{
  // Unknown/failed/interrupted calls keep the full reservation. Never retry free.
  if(settled)return;settled=true;
  const actual=usageCost(usage,model);
  if(actual===null||actual<=0)return;
  if(actual>reserve){await pool.query(`UPDATE resolute.${table} SET reserved_usd=reserved_usd+$2 WHERE month=$1`,[month,Number((actual-reserve).toFixed(4))]);return;}
  await pool.query(`UPDATE resolute.${table} SET reserved_usd=GREATEST(0,reserved_usd-$2) WHERE month=$1`,[month,Number((reserve-actual).toFixed(4))]);
 };
 settle.release=async()=>{
  if(settled)return;settled=true;
  await pool.query(`UPDATE resolute.${table} SET reserved_usd=GREATEST(0,reserved_usd-$2) WHERE month=$1`,[month,reserve]);
 };
 return settle;
}
/** HTTP statuses of a request the provider refused before any work (never billed): its reservation is given back. */
export const UNBILLED_STATUSES=Object.freeze([400,401,403,404,422,429]);
/** The month's AI spend (risk_budget, reserved and settled) against its limit; null when either is unknown. Never throws. */
export async function monthSpend(pool,now=new Date(),{table='risk_budget',limit}={}){
 try{
  if(!BUDGET_TABLES.has(table))return null;
  const cap=limit??monthlyAiLimit(),row=(await pool.query(`SELECT reserved_usd FROM resolute.${table} WHERE month=$1`,[riskDate(now).slice(0,7)])).rows?.[0];
  const used=Number(row?.reserved_usd??0);return Number.isFinite(used)&&used>=0?{used,limit:cap}:null;
 }catch{return null;}
}
