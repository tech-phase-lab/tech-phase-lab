import type { PoolClient } from "pg";
import type { QueuedNotification } from "./notification-dispatch.ts";

type Database = Pick<PoolClient, "query">;
/** Inside the queue transaction and the shared user lock. Only rows created by
 * this protocol can prove that no provider call has started. Legacy/attempting
 * rows block further alerts until their actual receipt has been reconciled.
 * Queue workers need UPDATE(payload), in addition to their existing grants.
 */
export async function reconcileAlertReservations(db:Database,userId:string,current:{revision:number;ruleKey:string;date:string}) {
 const pending=(await db.query(`SELECT idempotency_key,payload,delivery_date_jst::text AS date
  FROM resolute.notification_outbox WHERE clerk_user_id=$1 AND kind='alerts'
  AND accepted_at IS NULL AND COALESCE(payload->'reservation'->>'status','')<>'cancelled'
  ORDER BY created_at DESC,idempotency_key DESC FOR UPDATE`,[userId])).rows;
 // More than one unresolved reservation belongs to the old protocol. Do not
 // guess which state/receipt is authoritative or roll back over a later send.
 if(pending.length>1)return true;
 for(const row of pending){
  const p=row.payload,r=p.reservation;
  if(r?.version!==1||r.status!=="queued")return true;
  if(p.settingsRevision===current.revision&&p.ruleKey===current.ruleKey&&row.date===current.date)return true;
  if(!r.baseState||!r.nextState)throw new Error("Invalid alert reservation");
  const restored=await db.query(`UPDATE resolute.notification_state SET notified=$3
   WHERE clerk_user_id=$1 AND rule_key=$2 AND notified=$4::jsonb RETURNING clerk_user_id`,
   [userId,p.ruleKey,JSON.stringify(r.baseState),JSON.stringify(r.nextState)]);
  if(restored.rowCount!==1)throw new Error("Alert reservation state mismatch");
  await db.query(`UPDATE resolute.notification_outbox
   SET payload=jsonb_set(payload,'{reservation,status}','"cancelled"'::jsonb)
   WHERE clerk_user_id=$1 AND idempotency_key=$2`,[userId,row.idempotency_key]);
 }
 return false;
}

/** Call under the shared user lock, in autocommit BEFORE contacting a provider.
 * The committed marker survives send/ack failure. Never put this update inside
 * a transaction that can roll back after a provider accepted a message.
 * A stale in-memory task cannot claim a cancelled or replaced reservation.
 */
export async function claimAlertReservation(db:Database,userId:string,task:QueuedNotification,provider:string|null=null) {
 if(task.kind!=="alerts")throw new Error("Alert task required");
 const claimed=await db.query(`UPDATE resolute.notification_outbox
  SET payload=jsonb_set(jsonb_set(jsonb_set(payload,'{reservation,status}','"attempting"'::jsonb),
   '{reservation,provider}',$6::jsonb),'{reservation,attemptedAt}',to_jsonb(statement_timestamp()))
  WHERE clerk_user_id=$1 AND idempotency_key=$2 AND kind='alerts' AND accepted_at IS NULL
  AND delivery_date_jst=$3::date AND payload->>'ruleKey'=$4
  AND payload->'settingsRevision'=$5::jsonb
  AND payload->'reservation'->>'version'='1' AND payload->'reservation'->>'status'='queued'
  RETURNING idempotency_key`,[userId,task.key,task.deliveryDateJst,task.ruleKey,JSON.stringify(task.settingsRevision),JSON.stringify(provider)]);
 return claimed.rowCount===1;
}
