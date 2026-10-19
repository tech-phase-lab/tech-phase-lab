import { entitlementSource, readEntitlementSnapshot, type EntitlementSource } from "./entitlement-source.ts";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { parsePlanSnapshot } from "./plan-data.ts";
import { defaultNotificationSettings, parseNotificationSettings } from "./notification-settings.ts";
import { prepareNotificationSlot, jstSlot, type NotificationContext, type NotificationTask } from "./notification-job.ts";
import { resolveResoluteEntitlements, type EntitlementRecord } from "./entitlements.ts";
type Inputs=Pick<NotificationContext,"locale"|"preferencesConfigured"|"recipientVerified"|"unsubscribed"|"marketDate"|"closes">;
/** Durable queue only. SMTP/provider calls must not occur inside this transaction.
 * resolveInputs must return fresh verified account consent and provider-final closes, never request-body identity.
 * Sender remains a separate, disabled-until-approved integration. An outbox row is NOT proof of delivery.
 */
export function createNotificationOutboxJob(pool:Pick<Pool,"connect">,resolveInputs:(userId:string,symbols:string[])=>Promise<Inputs>,clock:()=>Date=()=>new Date(),source:EntitlementSource=entitlementSource()) {
 return async (userId:string)=>{
  if(!/^user_[A-Za-z0-9]{1,128}$/.test(userId))throw new Error("Invalid identity");
  const client=await pool.connect();
  try{
   await client.query("BEGIN");
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",[userId]);
   const row=(await client.query("SELECT settings,revision FROM resolute.notification_settings WHERE clerk_user_id=$1",[userId])).rows[0];
   const settings=parseNotificationSettings(row?.settings??defaultNotificationSettings());
   const live=source==="live"?await readEntitlementSnapshot(client,userId,source):null;
   const rights=live?[]:(await client.query("SELECT kind,starts_at,expires_at,revoked_at FROM resolute.entitlements WHERE clerk_user_id=$1 AND product_id='resolute_v1'",[userId])).rows;
   const entitlements:EntitlementRecord[]=live?live.records:rights.map(r=>({kind:r.kind,startsAt:r.starts_at.toISOString(),expiresAt:r.expires_at?.toISOString()??null,revokedAt:r.revoked_at?.toISOString()??null}));
   if(!resolveResoluteEntitlements(entitlements,clock().toISOString()).canReceiveNotifications||
    jstSlot(clock()).hour!==settings.deliveryHourJst||(!settings.alertsEnabled&&!settings.morningEnabled)){
    await client.query("COMMIT");return [];
   }
   const p=(await client.query("SELECT plan,revision,created_at,updated_at FROM resolute.plans WHERE clerk_user_id=$1",[userId])).rows[0];
   const plan=parsePlanSnapshot(p?{plan:p.plan?{...p.plan,createdAt:p.created_at.toISOString(),updatedAt:p.updated_at.toISOString()}:null,revision:Number(p.revision)}:{plan:null,revision:0}).plan;
   // A new reference price or set of thresholds is a new rule; a delivery-hour change is not.
   const ruleKey=createHash("sha256").update(JSON.stringify({items:settings.watchItems,lines:plan?.buyLines.map(l=>l.dropPct)??[],surge:settings.surgeCapPct})).digest("hex");
   const previous=(await client.query("SELECT rule_key,notified FROM resolute.notification_state WHERE clerk_user_id=$1",[userId])).rows[0];
   const receipt=(await client.query("SELECT idempotency_key,accepted_at FROM resolute.notification_outbox WHERE clerk_user_id=$1 AND kind='alerts' AND accepted_at IS NOT NULL ORDER BY accepted_at DESC LIMIT 1",[userId])).rows[0];
   const inputs=await resolveInputs(userId,settings.watchItems.map(i=>i.symbol));
   const tasks=prepareNotificationSlot(userId,clock(),{...inputs,settings,plan,entitlements,state:previous?.rule_key===ruleKey?previous.notified:{},lastConfirmedAlert:receipt?{id:receipt.idempotency_key,acceptedAt:receipt.accepted_at.toISOString()}:null});
   const results:{kind:NotificationTask["kind"];status:"queued"|"duplicate"}[]=[];
   for(const task of tasks){
    const content=task.kind==="alerts"?{digest:task.digest}:{locale:task.locale,sourceAlertId:task.sourceAlertId};
    const payload={...content,settingsRevision:Number(row.revision),ruleKey};
    const inserted=await client.query(`INSERT INTO resolute.notification_outbox(idempotency_key,clerk_user_id,kind,delivery_date_jst,payload)
     VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING idempotency_key`,[task.key,userId,task.kind,task.deliveryDateJst,JSON.stringify(payload)]);
    if(inserted.rowCount===0){results.push({kind:task.kind,status:"duplicate"});continue;}
    if(task.kind==="alerts")await client.query(`INSERT INTO resolute.notification_state(clerk_user_id,rule_key,notified) VALUES($1,$2,$3)
     ON CONFLICT(clerk_user_id) DO UPDATE SET rule_key=$2,notified=$3`,[userId,ruleKey,JSON.stringify(task.nextState)]);
    results.push({kind:task.kind,status:"queued"});
   }
   await client.query("COMMIT");return results;
  }catch(e){try{await client.query("ROLLBACK");}catch{}throw e;}finally{client.release();}
 };
}
