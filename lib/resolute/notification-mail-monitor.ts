import type { Pool } from 'pg';
import { createResendAlertProvider, resendOutboxEvidence } from './notification-resend.ts';

/** Read provider state only. No sends, schedules or automatic retries. */
export function createMailMonitor(pool:Pick<Pool,'connect'>,options:{enabled?:boolean;apiKey:string;from:string;request?:typeof fetch;now?:()=>Date}) {
 const now=options.now??(()=>new Date());
 return async()=>{
  const report={enabled:!!options.enabled,checked:0,delivered:0,pending:0,failed:0,unavailable:0,incomplete:false};
  if(!options.enabled)return report;
  const client=await pool.connect();let discard=false;const deadline=Date.now()+30000;
  try{
   const rows=(await client.query(`SELECT clerk_user_id,idempotency_key FROM resolute.notification_outbox
    WHERE kind IN ('alerts','morning') AND (payload->'reservation'->>'provider'='resend' OR (accepted_at IS NULL AND (payload->'reservation'->>'status'='queued' OR (kind='morning' AND NOT(payload?'reservation')))))
    ORDER BY COALESCE(payload->'mailMonitor'->>'checkedAt',''),created_at,idempotency_key LIMIT 26`)).rows;
   report.incomplete=rows.length>25;
   for(const row of rows.slice(0,25)){
    if(Date.now()>=deadline){report.incomplete=true;break;}
    const userId=row.clerk_user_id,key=row.idempotency_key;
    discard=true;
    const lock=await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[userId]);discard=false;
    if(!lock.rows[0]?.locked){report.incomplete=true;continue;}
    try{
     const current=(await client.query('SELECT payload FROM resolute.notification_outbox WHERE clerk_user_id=$1 AND idempotency_key=$2',[userId,key])).rows[0];
     if(!current){report.incomplete=true;continue;}
     let result:'delivered'|'pending'|'failed'|'unavailable'='pending';
     const facts=current.payload.resendFeedback?.facts??{};
     const adverse=!!current.payload.resendFailure||['bounced','complained','suppressed','failed'].some(k=>Object.hasOwn(facts,k));
     if(adverse)result='failed';
     else if(current.payload.resend){
      try{
       const observation=await createResendAlertProvider({...options,enabled:true},resendOutboxEvidence(client,userId),options.request,now).inspect(key,AbortSignal.timeout(5000));
       if(observation?.status==='delivered')result='delivered';
       else if(observation&&['bounced','complained','suppressed','failed'].includes(observation.status))result='failed';
      }catch{result='unavailable';}
     }
     await client.query(`UPDATE resolute.notification_outbox SET payload=jsonb_set(payload,'{mailMonitor}',$3::jsonb) WHERE clerk_user_id=$1 AND idempotency_key=$2`,[userId,key,JSON.stringify({checkedAt:now().toISOString(),result})]);
     report.checked++;report[result]++;
    }finally{try{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[userId]);}catch{discard=true;throw Error('Monitor lock release failed');}}
   }
   return report;
  }finally{client.release(discard);}
 };
}
