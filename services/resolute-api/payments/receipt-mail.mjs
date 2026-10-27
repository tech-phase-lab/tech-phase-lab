import { createHash } from 'node:crypto';
import { readJson } from './paypal.mjs';
import { verifyOrder } from './policy.mjs';
import { recoveryMail, RECOVERY_LIFETIME } from './recovery.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
const email=s=>typeof s==='string' && s.length<=320 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s);
const uuid=s=>typeof s==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s);
const S='resolute_payments_live';
const bad=new Set(['bounced','complained','failed','suppressed']);
const events=new Set(['sent','delivered','delivery_delayed',...bad]);

// Fixed Resend API only. POST acceptance and recipient-server delivery are distinct.
// Official contract: resend.com/docs/api-reference/emails/{send-email,retrieve-email}
export function receiptProvider({apiKey,from},request=fetch) {
  if(!/^re_[A-Za-z0-9_-]{10,200}$/.test(apiKey??'')||!email(from))throw Error('Receipt provider unavailable');
  async function api(path,body,key) {
    const response=await request('https://api.resend.com'+path,{method:body?'POST':'GET',cache:'no-store',redirect:'error',
      signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok){await response.body?.cancel();throw Error('Receipt provider unavailable');}
    return readJson(response,262144);
  }
  return {from,
    async send(orderId,to,mail) {
      if(!uuid(orderId)||!email(to))throw Error('Invalid receipt');
      const data=await api('/emails',{from,to:[to],subject:mail.subject,text:mail.text,tags:[{name:'resolute_receipt',value:orderId}]},'resolute-receipt-'+orderId);
      if(!uuid(data.id))throw Error('Invalid receipt');return data.id;
    },
    async inspect(row) {
      if(!uuid(row.provider_id))throw Error('Invalid receipt');
      const data=await api('/emails/'+row.provider_id);
      if(data.id!==row.provider_id||data.object!=='email'||hash(data.from??'')!==row.from_hash||
        !Array.isArray(data.to)||data.to.length!==1||!email(data.to[0])||hash(data.to[0])!==row.recipient_hash||
        (data.cc!=null&&(!Array.isArray(data.cc)||data.cc.length))||(data.bcc!=null&&(!Array.isArray(data.bcc)||data.bcc.length))||data.scheduled_at!=null||
        !Array.isArray(data.tags)||data.tags.filter(t=>t.name==='resolute_receipt').length!==1||
        !data.tags.some(t=>t.name==='resolute_receipt'&&t.value===row.order_id))throw Error('Receipt mismatch');
      return events.has(data.last_event)?data.last_event:'unknown';
    },
  };
}

// No startup registration and no automatic resending of ambiguous attempts.
// Address and signed link exist only in memory; neither is stored in the ledger.
export function receiptWorker({pool,paypal,provider,tokens,merchantId,origin,enabled=false,now=Date.now}) {
  return async()=>{
    const report={enabled,accepted:0,delivered:0,uncertain:0,blocked:0,errors:0};
    if(!enabled)return report;
    const time=now(),later=new Date(time+10*60000);
    await pool.query(`UPDATE ${S}.guest_receipts SET state='uncertain' WHERE state='attempting' AND checked_at<$1 AND provider_id IS NULL`,[new Date(time-10*60000)]);
    const rows=(await pool.query(`SELECT r.*,o.user_id,o.guest_id,o.state AS order_state,o.paid_at,o.quote,o.paypal_id,o.capture_id,
      o.capture_checked_at,o.capture_pro_until,o.expires_at,o.id FROM ${S}.guest_receipts r JOIN ${S}.orders o ON o.id=r.order_id
      WHERE r.state IN ('ready','accepted','attempting') AND r.next_check_at<=$1 ORDER BY r.created_at LIMIT 10`,[new Date(time)])).rows;
    for(const raw of rows) {
      const row=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,v instanceof Date?v.toISOString():v]));
      try {
        if(row.order_state!=='paid'||row.user_id!==row.guest_id||time>=Date.parse(row.paid_at)+RECOVERY_LIFETIME) {
          await pool.query(`UPDATE ${S}.guest_receipts SET state=$2 WHERE order_id=$1 AND state IN ('ready','accepted','attempting')`,[row.order_id,row.order_state!=='paid'||row.user_id!==row.guest_id?'closed':'blocked']);continue;
        }
        if(row.provider_id) {
          const event=await provider.inspect(row),state=bad.has(event)?'blocked':event==='delivered'?'delivered':'accepted';
          await pool.query(`UPDATE ${S}.guest_receipts SET state=$2,last_event=$3,checked_at=$4,next_check_at=$5 WHERE order_id=$1 AND state IN ('accepted','attempting') AND provider_id=$6`,
            [row.order_id,state,event,new Date(time),later,row.provider_id]);
          if(state==='delivered')report.delivered++;if(state==='blocked')report.blocked++;continue;
        }
        if(row.state!=='ready'){report.uncertain++;continue;}
        const remote=await paypal.get(row.paypal_id),verified=verifyOrder(row,remote,merchantId,true);
        if(verified.captureId!==row.capture_id||Date.parse(verified.paidAt)!==Date.parse(row.paid_at))throw Error('Payment mismatch');
        const first=remote.payer?.email_address,second=remote.payment_source?.paypal?.email_address,to=first??second;
        if(!email(to)||(first&&second&&first!==second))throw Error('Verified payer address unavailable');
        const recipientHash=hash(to),fromHash=hash(provider.from);
        const suppressed=await pool.query(`SELECT 1 FROM ${S}.guest_receipts WHERE recipient_hash=$1 AND last_event IN ('bounced','complained','suppressed') LIMIT 1`,[recipientHash]);
        if(suppressed.rows.length){await pool.query(`UPDATE ${S}.guest_receipts SET state='blocked' WHERE order_id=$1 AND state='ready'`,[row.order_id]);report.blocked++;continue;}
        const mail=recoveryMail(row,tokens.issue(row),origin);
        // Durable compare-and-set BEFORE sending. Workers cannot both send this order.
        const claim=await pool.query(`UPDATE ${S}.guest_receipts r SET state='attempting',recipient_hash=$2,from_hash=$3,attempts=attempts+1,checked_at=$4,next_check_at=$5
          WHERE order_id=$1 AND state='ready' AND EXISTS(SELECT 1 FROM ${S}.orders o WHERE o.id=r.order_id AND o.state='paid' AND o.user_id=o.guest_id) RETURNING order_id`,
          [row.order_id,recipientHash,fromHash,new Date(time),later]);
        if(!claim.rows.length)continue;
        try {
          const id=await provider.send(row.order_id,to,mail);
          const bound=await pool.query(`UPDATE ${S}.guest_receipts SET provider_id=$2,state='accepted' WHERE order_id=$1 AND state='attempting' AND provider_id IS NULL RETURNING order_id`,[row.order_id,id]);
          if(!bound.rows.length)throw Error('Receipt not recorded');report.accepted++;
        }catch{
          await pool.query(`UPDATE ${S}.guest_receipts SET state='uncertain' WHERE order_id=$1 AND state='attempting' AND provider_id IS NULL`,[row.order_id]);report.uncertain++;
        }
      }catch{
        // Pre-send failures may retry safely; exhausted or ambiguous sends need review.
        await pool.query(`UPDATE ${S}.guest_receipts SET next_check_at=$2,attempts=attempts+1,state=CASE WHEN attempts>=11 AND state='ready' THEN 'blocked' ELSE state END WHERE order_id=$1`,[row.order_id,later]);report.errors++;
      }
    }
    const unresolved=await pool.query(`SELECT count(*)::int AS n FROM ${S}.guest_receipts WHERE state IN ('uncertain','blocked')`);
    return {...report,needsReview:unresolved.rows[0].n};
  };
}
