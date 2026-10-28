import type {Pool} from 'pg';
import {jstSlot} from './notification-job.ts';

type Delivery=(userId:string,key:string,mode:'send'|'reconcile')=>Promise<string>;
/** Consumes existing alert and morning reservations. Never generates prices or changes
 * the approved morning scheduler. Every send rechecks consent and entitlements.
 */
export function createMailWorker(pool:Pick<Pool,'connect'>,options:{enabled?:boolean;deliver:Delivery;now?:()=>Date}) {
 const now=options.now??(()=>new Date());
 return async()=>{
  const report={enabled:!!options.enabled,checked:0,accepted:0,reconciled:0,suppressed:0,uncertain:0,errors:0,incomplete:false};
  if(!options.enabled)return report;
  const slot=jstSlot(now()),deadline=Date.now()+30000;
  const reader=await pool.connect();let rows;
  try{
   rows=(await reader.query(`SELECT o.clerk_user_id,o.idempotency_key,o.payload->'reservation'->>'status' AS status
    FROM resolute.notification_outbox o LEFT JOIN resolute.notification_settings s USING(clerk_user_id)
    WHERE o.kind IN ('alerts','morning') AND o.accepted_at IS NULL AND (
     (o.payload->'reservation'->>'status'='attempting' AND o.payload->'reservation'->>'provider'='resend') OR
     ((o.payload->'reservation'->>'status'='queued' OR (o.kind='morning' AND NOT(o.payload?'reservation'))) AND o.delivery_date_jst=$1::date AND s.settings->>'deliveryHourJst'=$2))
    ORDER BY COALESCE(o.payload->'mailWorker'->>'checkedAt',''),o.created_at,o.idempotency_key LIMIT 26`,[slot.date,String(slot.hour)])).rows;
  }finally{reader.release();}
  report.incomplete=rows.length>25;
  for(const row of rows.slice(0,25)){
   if(Date.now()>=deadline){report.incomplete=true;break;}
   let result:string;
   try{result=await options.deliver(row.clerk_user_id,row.idempotency_key,row.status==='attempting'?'reconcile':'send');}
   catch{result='error';}
   const category=result==='accepted'||result==='already-accepted'?'accepted':result==='reconciled'?'reconciled':
    ['suppressed','cancelled','missing','not-attempted'].includes(result)?'suppressed':result==='uncertain'?'uncertain':'errors';
   report.checked++;report[category]++;
   // Separate short connection: the delivery path owns its per-user lock and
   // commits attempt markers independently of this fairness/monitor timestamp.
   const writer=await pool.connect();
   try{await writer.query(`UPDATE resolute.notification_outbox SET payload=jsonb_set(payload,'{mailWorker}',$3::jsonb)
    WHERE clerk_user_id=$1 AND idempotency_key=$2 AND kind IN ('alerts','morning')`,[row.clerk_user_id,row.idempotency_key,JSON.stringify({checkedAt:now().toISOString(),result:category})]);}
   finally{writer.release();}
  }
  return report;
 };
}
