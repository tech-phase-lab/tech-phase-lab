import {isOwnerAccount} from '../../lib/membership/entitlements.ts';
import {riskPool,boundedJSON} from './risk-store.mjs';
import {reserveAiSpend,serializeBudgetedRequest} from './ai-budget.mjs';

// One owner-authorized check, across processes, restarts and key rotations.
// Never change this ID to work around an uncertain or failed attempt.
export const AI_CHECK_ID='owner-key-check-2026-10-23';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
export async function aiCheckRequest(request,userId,{env=process.env,poolFactory=riskPool,fetcher=fetch,reserve=reserveAiSpend}={}){
 if(!isOwnerAccount(userId))return json({error:'FORBIDDEN'},403);
 if(!['GET','POST'].includes(request.method))return json({error:'METHOD_NOT_ALLOWED'},405);
 let pool;
 try{
  pool=poolFactory();
  if(request.method==='GET'){
   const row=(await pool.query('SELECT state,result FROM resolute.ai_connection_checks WHERE id=$1',[AI_CHECK_ID])).rows[0];
   return json({checkId:AI_CHECK_ID,state:row?.state??'not-started',result:row?.result??null,
    enabled:env.RESOLUTE_AI_CHECK_ENABLED==='true',keyConfigured:!!env.RESOLUTE_OPENAI_API_KEY});
  }
  if(env.RESOLUTE_AI_CHECK_ENABLED!=='true')return json({error:'CHECK_DISABLED'},503);
  if(!env.RESOLUTE_OPENAI_API_KEY)return json({error:'KEY_NOT_CONFIGURED'},503);
  let input;try{input=await boundedJSON(request,128);}catch{return json({error:'INVALID_INPUT'},400);}
  if(!input||Object.keys(input).length!==1||input.action!=='check')return json({error:'INVALID_INPUT'},400);
  const body=serializeBudgetedRequest({model:'gpt-5.4-mini',reasoning:{effort:'none'},max_output_tokens:128,
   input:'Connection test only. Reply with exactly RESOLUTE_OK.',store:false});
  // This autocommit is durable before any model request. No delete/retry path.
  const claim=await pool.query(`INSERT INTO resolute.ai_connection_checks(id,state) VALUES($1,'claimed') ON CONFLICT(id) DO NOTHING RETURNING id`,[AI_CHECK_ID]);
  if(!claim.rows.length)return json({error:'ALREADY_ATTEMPTED',checkId:AI_CHECK_ID},409);
  let result,settle;
  try{settle=await reserve(pool);}catch{
   result={ok:false,error:'BUDGET_UNAVAILABLE',modelRequestAttempted:false};
  }
  if(!result){
   try{
    const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',
     headers:{Authorization:`Bearer ${env.RESOLUTE_OPENAI_API_KEY}`,'Content-Type':'application/json'},
     body,redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!response.ok){
     await response.body?.cancel();
     result={ok:false,error:response.status===401?'OPENAI_AUTH_REJECTED':response.status===403?'OPENAI_ACCESS_DENIED':response.status===429?'OPENAI_RATE_OR_QUOTA_LIMIT':'OPENAI_REQUEST_FAILED',httpStatus:response.status,modelRequestAttempted:true};
    }else{
     const data=await boundedJSON(response,32000);
     const output=(data.output??[]).filter(x=>x.type==='message').flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text).join('').trim();
     result={ok:data.status==='completed'&&output==='RESOLUTE_OK',modelRequestAttempted:true,
      ...(data.status==='completed'&&output==='RESOLUTE_OK'?{reply:'RESOLUTE_OK'}:{error:'UNEXPECTED_RESPONSE'})};
     try{await settle(data.usage);}catch{result.budgetSettlementPending=true;}
    }
   }catch{result={ok:false,error:'RESPONSE_UNCONFIRMED',modelRequestAttempted:true};}
  }
  try{await pool.query('UPDATE resolute.ai_connection_checks SET state=$2,result=$3 WHERE id=$1',[AI_CHECK_ID,result.ok?'verified':'unverified',JSON.stringify(result)]);}
  catch{return json({error:'RESULT_NOT_RECORDED',modelRequestMayHaveRun:true},503);}
  return json({checkId:AI_CHECK_ID,...result},result.ok?200:502);
 }catch{return json({error:'CHECK_STORAGE_UNAVAILABLE'},503);}
}
