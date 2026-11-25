import {parseTonightQuestions,tonightPrompt} from '../../lib/resolute/tonight.ts';
import {riskPool,boundedJSON} from './risk-store.mjs';
import {reserveAiSpend,serializeBudgetedRequest} from './ai-budget.mjs';

/** 今夜の3つの質問 (owner, Nov 25): the AI writes three questions from the member's rules and tonight's move.
 * The same model, budget and request limits as the other RESOLUTE AI work (gpt-5.4-mini, ai-budget.mjs: one 10-cent reservation per
 * request, settled to the real cost). Numbers are never written by the model: parseTonightQuestions rejects any digit in its text, and
 * each question's number line is one of the member's own notes picked by id. One retry when the reply does not pass; then null (the
 * page shows the fixed three). Off unless RESOLUTE_TONIGHT_AI_ENABLED=true and the key is set.
 * Usable from the per-member daily job as well (one call per member and night): pass the same facts. */
export function createTonightQuestionGenerator({env=process.env,fetcher=fetch,poolFactory=riskPool,reserve=reserveAiSpend}={}){
 if(env.RESOLUTE_TONIGHT_AI_ENABLED!=='true'||!env.RESOLUTE_OPENAI_API_KEY)return undefined;
 let pool;
 return async(facts,night)=>{
  pool??=poolFactory();
  for(let attempt=0;attempt<2;attempt++){
   const body=serializeBudgetedRequest({model:'gpt-5.4-mini',reasoning:{effort:'none'},max_output_tokens:700,store:false,input:tonightPrompt(facts)});
   let settle;try{settle=await reserve(pool);}catch{return null;}
   let data;
   try{
    const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${env.RESOLUTE_OPENAI_API_KEY}`,'Content-Type':'application/json'},body,redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok){await response.body?.cancel();return null;}
    data=await boundedJSON(response,32000);
   }catch{return null;}
   try{await settle(data?.usage);}catch{/* the full reservation stays */}
   const text=(data?.output??[]).filter(x=>x.type==='message').flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
   const parsed=data?.status==='completed'?parseTonightQuestions(text,facts,night):null;
   if(parsed)return parsed;
  }
  return null;
 };
}
