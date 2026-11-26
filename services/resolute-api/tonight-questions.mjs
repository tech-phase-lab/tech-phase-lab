import {parseTonightQuestions,tonightPrompt,tonightFacts,tonightIndex,tonightMove,TONIGHT_QUESTIONS_SCHEMA} from '../../lib/resolute/tonight.ts';
import {reserveAiSpend,serializeBudgetedRequest,todayPlanMonthlyLimit,TODAY_PLAN_RESERVATION_USD} from './ai-budget.mjs';
import {boundedJSON} from './risk-store.mjs';

/** 今夜の3つの質問 (owner, Nov 25): made in the same daily member job as 「今日やること」 (today-plan-job.mjs, the hook below), with
 * the same model, the same monthly AI bucket (today_plan_budget, RESOLUTE_TODAY_PLAN_MONTHLY_LIMIT_USD) and the same rules: numbers
 * never come from the model (parseTonightQuestions rejects any number token in its text, with today-plan-validate's numberTokens;
 * each question's number line is one of the member's own notes picked by id), one regeneration, then the fixed three on the page.
 * Off unless RESOLUTE_TONIGHT_AI_ENABLED=true. */
export const TONIGHT_MAX_OUTPUT_TOKENS=600;
export const TONIGHT_REQUEST_REASONS=['BUDGET_LIMIT','AI_BUDGET_NOT_CONFIGURED','AI_REQUEST_OUTSIDE_BUDGET','MODEL_NOT_CONFIGURED','MODEL_INCOMPLETE'];

/** One model request (Responses API, strict JSON schema), through the today-plan budget bucket. Returns the reply text. */
export function createTonightQuestionModel({apiKey,pool,fetcher=fetch,limit,now=()=>new Date()}){
 return async(facts,previousAttemptRejected=false)=>{
  if(!apiKey)throw Error('MODEL_NOT_CONFIGURED');
  const body=serializeBudgetedRequest({model:'gpt-5.4-mini',store:false,reasoning:{effort:'none'},max_output_tokens:TONIGHT_MAX_OUTPUT_TOKENS,
   input:tonightPrompt(facts)+(previousAttemptRejected?'\nYour previous reply broke a rule. Follow every rule exactly.':''),
   text:{format:{type:'json_schema',name:'resolute_tonight_questions',strict:true,schema:TONIGHT_QUESTIONS_SCHEMA}}});
  const settle=await reserveAiSpend(pool,now(),{table:'today_plan_budget',limit:limit??todayPlanMonthlyLimit(),reserve:TODAY_PLAN_RESERVATION_USD});
  const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(40000),body});
  if(!response.ok){await response.body?.cancel();throw Error('MODEL_UNAVAILABLE');}
  const data=await boundedJSON(response,50000);if(data.status!=='completed')throw Error('MODEL_INCOMPLETE');
  await settle(data.usage);
  return {text:(data.output??[]).flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text).join(''),usage:data.usage??null};
 };
}
/** Facts → questions: the model's reply when it passes every check (one regeneration), else null (the page shows the fixed three). */
export async function generateTonightQuestions(facts,night,model){
 const reasons=[],usage=[];
 if(!model)return {questions:null,reasons:['model-not-configured'],usage};
 for(let attempt=0;attempt<2;attempt++){
  let reply;
  try{reply=await model(facts,attempt>0);if(reply.usage)usage.push(reply.usage);}
  catch(error){const code=TONIGHT_REQUEST_REASONS.includes(error?.message)?error.message:'MODEL_UNAVAILABLE';reasons.push(code);
   if(code!=='MODEL_UNAVAILABLE'&&code!=='MODEL_INCOMPLETE')break;continue;}
  const parsed=parseTonightQuestions(reply.text,facts,night);
  if(parsed)return {questions:parsed,reasons,usage};
  reasons.push('rejected');
 }
 return {questions:null,reasons,usage};
}
/** The per-member hook for runTodayPlanJob: one attempt per member and market date, claimed before the model is asked. */
export function createTonightJobHook({pool,model}){
 return async({id,session,snapshot,plan,settings})=>{
  const index=tonightIndex(plan),move=tonightMove(snapshot,index);
  if(!move)return 'no-move';
  const claim=await pool.query(`INSERT INTO resolute.tonight_questions(clerk_user_id,night_date,state) VALUES($1,$2,'claimed')
   ON CONFLICT(clerk_user_id,night_date) DO NOTHING RETURNING night_date`,[id,session]);
  if(!claim.rows.length)return 'existing';
  const facts=tonightFacts({direction:move.direction,index,movePct:move.changePercent,plan,settings});
  const result=await generateTonightQuestions(facts,session,model).catch(()=>({questions:null,reasons:['MODEL_UNAVAILABLE'],usage:[]}));
  await pool.query(`UPDATE resolute.tonight_questions SET state=$3,questions=$4,updated_at=statement_timestamp() WHERE clerk_user_id=$1 AND night_date=$2`,
   [id,session,result.questions?'ready':'failed',result.questions?JSON.stringify(result.questions):null]);
  return result.questions?'ai':'fixed';
 };
}
