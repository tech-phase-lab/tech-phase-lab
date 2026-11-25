import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
// Allowlisted failure description for the run log: an error code from this service, where a PayPal call
// failed and its bare HTTP status, and the queue row's local state. Never ids, user ids, bodies or messages
// from elsewhere (those become OTHER). Without this a failed item is a bare "failed 1" (incident 2026-11-25).
const ERROR_CODES=new Set(['PAYPAL_UNAVAILABLE','PAYPAL_SUBSCRIPTION_NOT_FOUND','SUBSCRIPTION_NOT_FOUND','SETTLEMENT_REVIEW_REQUIRED',
 'SETTLEMENT_RETRY','INVALID_SUBSCRIPTION_STATE','INVALID_SUBSCRIPTION','INVALID_RECOVERY_RESULT','INVALID_OFFER','INVALID_PLAN',
 'INVALID_PERIOD','INVALID_TIME','INVALID_HOLD','PAYMENT_MISMATCH','PERIOD_CONFLICT','BILLING_TRANSACTION_FAILED']);
const STAGES=new Set(['auth','request','response','timeout','network']);
const STATES=new Set(['creating','approval_pending','active','suspended','cancelled','expired']);
export function describeFailure(error,item){
 const code=ERROR_CODES.has(error?.message)?error.message:'OTHER',detail=error?.detail,out={code};
 if(STAGES.has(detail?.stage))out.stage=detail.stage;
 if(Number.isInteger(detail?.status)&&detail.status>=100&&detail.status<=599)out.status=detail.status;
 if(STATES.has(item?.state))out.state=item.state;
 if(typeof item?.has_payments==='boolean')out.paid=item.has_payments;
 return out;
}
// An abandoned sign-up: still approval_pending 72 hours after it was created, with no payment, no
// payment event, no review hold and no adverse record. PayPal approval links do not outlive that, and the
// member's own checkout refuses to resume such a row after 71 hours (RECONCILIATION_REQUIRED).
export const ABANDON_AFTER_MS=72*3600000;
const S='tech_phase_billing_live';
const abandonedSql=(sub,now)=>`(${sub}.state='approval_pending' AND ${sub}.created_at <= ${now}::timestamptz - interval '72 hours'
     AND NOT EXISTS (SELECT 1 FROM ${S}.payments p WHERE p.subscription_id=${sub}.id)
     AND NOT EXISTS (SELECT 1 FROM ${S}.events e WHERE e.subscription_id=${sub}.id)
     AND NOT EXISTS (SELECT 1 FROM ${S}.review_holds h WHERE h.subscription_id=${sub}.id))`;
// The queue lives only in the dedicated Live database. Never enumerate Clerk users.
export function liveRecoveryQueue(pool){
 return {
  async claim(now=Date.now()){
   if(!Number.isFinite(now))throw Error('INVALID_TIME');
   const token=randomUUID();
   const result=await pool.query(`WITH candidate AS (
    SELECT q.subscription_id FROM tech_phase_billing_live.recovery_queue q
    JOIN tech_phase_billing_live.subscriptions o ON o.id=q.subscription_id
    WHERE q.next_attempt_at <= $1 AND (q.lease_until IS NULL OR q.lease_until <= $1)
    -- A closed sign-up that never had a payment has nothing left to reconcile.
    AND NOT (o.state='expired' AND NOT EXISTS (SELECT 1 FROM tech_phase_billing_live.payments p WHERE p.subscription_id=o.id))
    ORDER BY q.next_attempt_at,q.subscription_id FOR UPDATE SKIP LOCKED LIMIT 1
   ) UPDATE tech_phase_billing_live.recovery_queue q
     SET lease_token=$2,lease_until=$1::timestamptz+interval '5 minutes'
     FROM candidate c,tech_phase_billing_live.subscriptions s
     WHERE q.subscription_id=c.subscription_id AND s.id=q.subscription_id
     RETURNING q.subscription_id AS id,s.user_id,q.lease_token AS token,q.failures,s.state,
       EXISTS (SELECT 1 FROM tech_phase_billing_live.payments p WHERE p.subscription_id=s.id) AS has_payments,
       ${abandonedSql('s','$1')} AS abandoned`,[new Date(now),token]);
   return result.rows[0]??null;
  },
  // Close an abandoned sign-up after PayPal answered (authenticated) that it has no such subscription.
  // One statement re-checks every condition and the lease, so a payment, webhook event or approval that
  // lands meanwhile keeps the row open. Only state/updated_at change; nothing is deleted or granted.
  async closeAbandoned(item,now=Date.now()){
   if(!Number.isFinite(now))throw Error('INVALID_TIME');
   const result=await pool.query(`UPDATE ${S}.subscriptions s SET state='expired',updated_at=$3
    WHERE s.id=$1 AND ${abandonedSql('s','$3')}
    AND EXISTS (SELECT 1 FROM ${S}.recovery_queue q WHERE q.subscription_id=s.id AND q.lease_token=$2 AND q.lease_until>$3)
    RETURNING s.id`,[item.id,item.token,new Date(now)]);
   return result.rows.length===1;
  },
  async finish(item,outcome,now=Date.now()){
   if(!Number.isFinite(now)||!['verified','payment-pending','review-required','failed'].includes(outcome))throw Error('INVALID_RECOVERY_RESULT');
   // Backoff is capped; an error cannot starve the rest of the queue. The lease
   // token fences workers that resume after another process has reclaimed work.
   const result=await pool.query(`UPDATE tech_phase_billing_live.recovery_queue SET
    failures=CASE WHEN $3='failed' THEN least(failures+1,20) ELSE 0 END,
    next_attempt_at=$4::timestamptz + CASE WHEN $3='failed' THEN
      make_interval(secs => least(3600,60*power(2,least(failures,6)))::int)
      WHEN $3='payment-pending' THEN interval '15 minutes' ELSE interval '6 hours' END,
    checked_at=$4,last_outcome=$3,lease_token=NULL,lease_until=NULL
    WHERE subscription_id=$1 AND lease_token=$2 AND lease_until>$4 RETURNING subscription_id`,[item.id,item.token,outcome,new Date(now)]);
   return result.rows.length===1;
  }
 };
}
export async function runLiveRecovery({env,services,signal,now=Date.now,wait=ms=>pause(ms)}){
 if(env.TECH_PHASE_BILLING_LIVE_RECOVERY_ENABLED!=='true')return {outcome:'disabled'};
 if(env.TECH_PHASE_PAYPAL_ENV!=='live'||env.TECH_PHASE_BILLING_RUNTIME!=='railway-live'||
  !env.TECH_PHASE_BILLING_LIVE_BRANCH||env.RAILWAY_GIT_BRANCH!==env.TECH_PHASE_BILLING_LIVE_BRANCH)throw Error('INVALID_RECOVERY_CONFIG');
 const limit=env.TECH_PHASE_BILLING_LIVE_RECOVERY_LIMIT===undefined?10:Number(env.TECH_PHASE_BILLING_LIVE_RECOVERY_LIMIT);
 if(!Number.isInteger(limit)||limit<1||limit>25)throw Error('INVALID_RECOVERY_CONFIG');
 const started=now();if(!Number.isFinite(started))throw Error('INVALID_TIME');
 const svc=await services();
 const result={outcome:'completed',checked:0,failed:0,reviewRequired:0,leaseLost:0,bounded:false};
 for(let n=0;n<limit;n++){
  if(signal?.aborted||now()-started>=180000){result.bounded=true;break;}
  const item=await svc.recoveryQueue.claim(now());if(!item)break;
  let outcome,failure=null,closed=false;
  try{
   const value=await svc.reconciliation.reconcile(item.user_id,item.id);
   if(value?.environment!=='live'||!['verified','payment-pending','review-required'].includes(value.status))throw Error('INVALID_RECOVERY_RESULT');
   outcome=value.status;
  }catch(error){
   const code=error?.message;
   // Abandoned: never approved or paid, 72h+ old (re-checked in SQL when closing).
   const abandoned=item.abandoned===true&&item.state==='approval_pending'&&item.has_payments===false;
   if(abandoned&&code==='PAYPAL_SUBSCRIPTION_NOT_FOUND'&&await svc.recoveryQueue.closeAbandoned(item,now())){
    // PayPal (authenticated) has no such subscription: close the sign-up as expired, reason "abandoned"
    // in the run log. Nothing is deleted or granted; the closed row is no longer claimed.
    closed=true;outcome='verified';
   }else if(abandoned&&code==='PAYPAL_UNAVAILABLE'){
    // PayPal could not answer for an abandoned, never-paid sign-up: nothing can be owed or granted, so
    // this is not an alert. Keep the row unchanged and ask again in six hours; it closes on a 404.
    outcome='review-required';(result.deferred??=[]).push(describeFailure(error,item));
   }else{
    // An authenticated provider 404 for an unpaid, unapproved application needs
    // review, not an infrastructure-crash loop. Preserve the record and retry
    // normally; never infer cancellation, payment or entitlement from a 404.
    // Previously paid/active contracts and all transport/auth failures remain
    // failures so real payment reconciliation problems cannot be hidden.
    outcome=code==='PAYPAL_SUBSCRIPTION_NOT_FOUND' &&
     item.state==='approval_pending' && item.has_payments===false ? 'review-required':'failed';
    if(outcome==='failed')failure=describeFailure(error,item);
   }
  }
  result.checked++;
  if(closed)result.abandoned=(result.abandoned??0)+1;
  if(outcome==='failed'){result.failed++;(result.errors??=[]).push(failure);}
  if(outcome==='review-required')result.reviewRequired++;
  if(!await svc.recoveryQueue.finish(item,outcome,now()))result.leaseLost++;
  if(n+1===limit){result.bounded=true;break;}
  if(!signal?.aborted)await wait(500);
 }
 if(result.failed||result.leaseLost)result.outcome='partial-failure';
 else if(result.bounded)result.outcome='bounded';
 return result;
}
