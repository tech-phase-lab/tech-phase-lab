import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
// The queue lives only in the dedicated Live database. Never enumerate Clerk users.
export function liveRecoveryQueue(pool){
 return {
  async claim(now=Date.now()){
   if(!Number.isFinite(now))throw Error('INVALID_TIME');
   const token=randomUUID();
   const result=await pool.query(`WITH candidate AS (
    SELECT q.subscription_id FROM tech_phase_billing_live.recovery_queue q
    WHERE q.next_attempt_at <= $1 AND (q.lease_until IS NULL OR q.lease_until <= $1)
    ORDER BY q.next_attempt_at,q.subscription_id FOR UPDATE SKIP LOCKED LIMIT 1
   ) UPDATE tech_phase_billing_live.recovery_queue q
     SET lease_token=$2,lease_until=$1::timestamptz+interval '5 minutes'
     FROM candidate c,tech_phase_billing_live.subscriptions s
     WHERE q.subscription_id=c.subscription_id AND s.id=q.subscription_id
     RETURNING q.subscription_id AS id,s.user_id,q.lease_token AS token,q.failures`,[new Date(now),token]);
   return result.rows[0]??null;
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
  let outcome;
  try{
   const value=await svc.reconciliation.reconcile(item.user_id,item.id);
   if(value?.environment!=='live'||!['verified','payment-pending','review-required'].includes(value.status))throw Error('INVALID_RECOVERY_RESULT');
   outcome=value.status;
  }catch{outcome='failed';}
  result.checked++;
  if(outcome==='failed')result.failed++;
  if(outcome==='review-required')result.reviewRequired++;
  if(!await svc.recoveryQueue.finish(item,outcome,now()))result.leaseLost++;
  if(n+1===limit){result.bounded=true;break;}
  if(!signal?.aborted)await wait(500);
 }
 if(result.failed||result.leaseLost)result.outcome='partial-failure';
 else if(result.bounded)result.outcome='bounded';
 return result;
}
