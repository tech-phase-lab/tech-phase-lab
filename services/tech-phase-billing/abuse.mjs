import {createHash} from 'node:crypto';
const windowMs=600000;
// Fixed ten-minute windows shared by all replicas, not a process-local Map.
export function billingAbuse(pool,{now=Date.now}={}) {
 async function count(userId,kind,limit) {
  if(!/^user_[A-Za-z0-9]{1,120}$/.test(userId))throw Error('INVALID_IDENTITY');
  const at=now(),start=Math.floor(at/windowMs)*windowMs;
  const actor=createHash('sha256').update(userId).digest('hex');
  const result=await pool.query(`WITH counted AS (
   INSERT INTO tech_phase_billing_live.security_windows(actor_ref,kind,window_start,count) VALUES($1,$2,$3,1)
   ON CONFLICT(actor_ref,kind,window_start) DO UPDATE SET count=tech_phase_billing_live.security_windows.count+1 RETURNING count
  ), alerted AS (
   INSERT INTO tech_phase_billing_live.security_alerts(actor_ref,kind,window_start,count)
   SELECT $1,$2,$3,count FROM counted WHERE count > $4 ON CONFLICT DO NOTHING RETURNING id
  ) SELECT count FROM counted`,[actor,kind,new Date(start),limit]);
  return {blocked:result.rows[0].count>limit,retryAfter:Math.max(1,Math.ceil((start+windowMs-at)/1000))};
 }
 return {
  async attempt(user){const result=await count(user,'attempt',5);if(result.blocked){const e=Error('RATE_LIMITED');e.retryAfter=result.retryAfter;throw e;}},
  async failure(user){await count(user,'failure',4);},
 };
}
// Delivery is at-least-once. A crash after delivery can repeat an alert, never a payment.
export async function deliverBillingAlerts(pool,deliver,{now=Date.now,limit=20}={}) {
 let sent=0,failed=0;
 for(let n=0;n<limit;n++) {
  const at=new Date(now());
  const row=(await pool.query(`UPDATE tech_phase_billing_live.security_alerts SET lease_until=$1::timestamptz+interval '5 minutes'
   WHERE id=(SELECT id FROM tech_phase_billing_live.security_alerts WHERE delivered_at IS NULL AND (lease_until IS NULL OR lease_until <= $1)
   ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,actor_ref,kind,count,window_start,lease_until`,[at])).rows[0];
  if(!row)break;
  try {
   await deliver({id:String(row.id),actorRef:row.actor_ref,kind:row.kind,count:row.count,windowStart:new Date(row.window_start).toISOString()});
   await pool.query('UPDATE tech_phase_billing_live.security_alerts SET delivered_at=$2,lease_until=NULL WHERE id=$1 AND lease_until=$3',[row.id,new Date(now()),row.lease_until]);sent++;
  }catch{failed++;} // Keep the record; retry after the lease expires.
 }
 await pool.query("DELETE FROM tech_phase_billing_live.security_windows WHERE window_start < $1::timestamptz-interval '7 days'",[new Date(now())]);
 return {sent,failed};
}
