import type { Pool } from "pg";
import type { Digest } from "./alert-judge.ts";
import { dispatchNotification, type QueuedNotification } from "./notification-dispatch.ts";
import { claimAlertReservation } from "./notification-reservation.ts";
import { readEntitlementSnapshot, entitlementSource, type EntitlementSource } from "./entitlement-source.ts";
import { parseNotificationSnapshot } from "./notification-settings.ts";
import { parsePlanSnapshot } from "./plan-data.ts";
import { notificationRuleKey } from "./notification-rule-key.ts";
import { renderAlertMail, type RenderedMail } from "./mail-templates.ts";

export type AlertReceipt={key:string;messageId:string;acceptedAt:string};
export type AlertRecipient={userId:string;email:string;verified:boolean;preferencesConfigured:boolean;unsubscribed:boolean;locale:"ja"|"en"};
export type AlertProvider={
 name:string;
 // Adapter must honor this key, use the abort signal, and normalize verified
 // provider responses. A duplicate alone is NOT a confirmed acceptance receipt.
 send:(input:{key:string;to:string;mail:RenderedMail},signal:AbortSignal)=>Promise<AlertReceipt|null>;
 lookup:(key:string,signal:AbortSignal)=>Promise<AlertReceipt|null>;
};
type Dependencies={
 enabled?:boolean;provider:AlertProvider;now?:()=>Date;source?:EntitlementSource;
 recipient:(userId:string)=>Promise<AlertRecipient>;
 links:(userId:string)=>Promise<{planUrl:string;unsubscribeUrl:string;tonightUrl?:string}>;
 publicOrigin:string;
};
function safeLinks(links:Awaited<ReturnType<Dependencies["links"]>>,origin:string) {
 const base=new URL(origin);
 if(base.protocol!=="https:"||base.username||base.password||base.origin!==origin)throw new Error("Invalid mail origin");
 for(const value of Object.values(links)){
  if(value===undefined)continue;
  const url=new URL(value);
  if(url.origin!==origin||url.username||url.password)throw new Error("Invalid mail link");
 }
 if(!links.planUrl||!links.unsubscribeUrl)throw new Error("Missing mail links");
 return links;
}
function validReceipt(receipt:AlertReceipt|null,key:string,attemptedAt:unknown,now:Date):receipt is AlertReceipt {
 if(!receipt||receipt.key!==key||typeof receipt.messageId!=="string"||!/^[A-Za-z0-9_.:-]{1,200}$/.test(receipt.messageId)||
  typeof receipt.acceptedAt!=="string"||typeof attemptedAt!=="string")return false;
 const at=Date.parse(receipt.acceptedAt),start=Date.parse(attemptedAt);
 // Provider timestamps may have only whole-second precision. Preserve that
 // original timestamp, while rejecting receipts from an earlier second.
 return Number.isFinite(at)&&Number.isFinite(start)&&Math.floor(at/1000)>=Math.floor(start/1000)&&at<=now.getTime();
}

/** Disabled unless explicitly injected as enabled. No provider, credentials,
 * cron, signup or endpoint is configured here. Only alert delivery is connected;
 * approved next-morning scheduling remains in notification-job.ts unchanged.
 * Session lock spans read/claim/send/receipt. No transaction wraps provider I/O,
 * so a send timeout or failed acknowledgement cannot erase the attempt marker.
 * Production wiring needs recipient verification, signed stop links, a provider
 * adapter and scoped SELECT/UPDATE(payload,accepted_at) permissions separately.
 */
export function createAlertDelivery(pool:Pick<Pool,"connect">,deps:Dependencies) {
 const clock=deps.now??(()=>new Date());
 return async(userId:string,key:string,mode:"send"|"reconcile"="send")=>{
  if(!deps.enabled)return "disabled";
  if(mode!=="send"&&mode!=="reconcile")throw new Error("Invalid delivery mode");
  if(!/^user_[A-Za-z0-9]{1,128}$/.test(userId)||key.length>200||!key.startsWith(userId+":"))throw new Error("Invalid delivery identity");
  if(!/^[a-z0-9-]{1,40}$/.test(deps.provider.name))throw new Error("Invalid provider identity");
  const client=await pool.connect();let locked=false,discard=false;
  try{
   discard=true;
   await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))",[userId]);locked=true;discard=false;
   const row=(await client.query(`SELECT payload,accepted_at,delivery_date_jst::text AS date FROM resolute.notification_outbox
    WHERE clerk_user_id=$1 AND idempotency_key=$2 AND kind='alerts'`,[userId,key])).rows[0];
   if(!row)return "missing";
   if(row.accepted_at!==null)return "already-accepted";
   const reservation=row.payload.reservation;
   if(reservation?.version!==1)return "review-required";
   if(reservation.status==="cancelled")return "cancelled";
   const acknowledge=async(receipt:AlertReceipt)=>{
    const result=await client.query(`UPDATE resolute.notification_outbox SET accepted_at=$3,
     payload=jsonb_set(payload,'{receipt}',$4::jsonb)
     WHERE clerk_user_id=$1 AND idempotency_key=$2 AND accepted_at IS NULL
     AND payload->'reservation'->>'status'='attempting'
     AND payload->'reservation'->>'provider'=$5 RETURNING idempotency_key`,
     [userId,key,receipt.acceptedAt,JSON.stringify({messageId:receipt.messageId,acceptedAt:receipt.acceptedAt}),deps.provider.name]);
    if(result.rowCount!==1)throw new Error("Receipt acknowledgement failed");
   };
   if(reservation.status==="attempting"){
    if(reservation.provider!==deps.provider.name||!reservation.attemptedAt)return "review-required";
    let receipt:AlertReceipt|null;
    try{receipt=await deps.provider.lookup(key,AbortSignal.timeout(15000));}catch{return "uncertain";}
    if(!validReceipt(receipt,key,reservation.attemptedAt,clock()))return "uncertain";
    await acknowledge(receipt);return "reconciled";
   }
   if(reservation.status!=="queued")return "review-required";
   if(mode==="reconcile")return "not-attempted";
   const task:QueuedNotification={key,kind:"alerts",deliveryDateJst:row.date,settingsRevision:row.payload.settingsRevision,ruleKey:row.payload.ruleKey,acceptedAt:null};
   let recipient:AlertRecipient|undefined,message:RenderedMail|undefined,receipt:AlertReceipt|null=null,attemptedAt:unknown;
   const result=await dispatchNotification(task,{
    deliveryEnabled:true,now:clock,
    read:async()=>{
     const saved=(await client.query("SELECT settings,revision FROM resolute.notification_settings WHERE clerk_user_id=$1",[userId])).rows[0];
     const snapshot=parseNotificationSnapshot(saved?{settings:saved.settings,revision:Number(saved.revision)}:undefined);
     const p=(await client.query("SELECT plan,revision,created_at,updated_at FROM resolute.plans WHERE clerk_user_id=$1",[userId])).rows[0];
     const plan=parsePlanSnapshot(p?{plan:p.plan?{...p.plan,createdAt:p.created_at.toISOString(),updatedAt:p.updated_at.toISOString()}:null,revision:Number(p.revision)}:{plan:null,revision:0}).plan;
     const rights=await readEntitlementSnapshot(client,userId,deps.source??entitlementSource());
     recipient=await deps.recipient(userId);
     if(recipient.userId!==userId)throw new Error("Recipient identity mismatch");
     return {settings:snapshot.settings,revision:snapshot.revision,ruleKey:notificationRuleKey(snapshot.settings,plan),entitlements:rights.records,
      recipientVerified:recipient.verified,preferencesConfigured:recipient.preferencesConfigured,unsubscribed:recipient.unsubscribed,planExists:!!plan};
    },
    claimAlert:async()=>{
     if(!recipient||!/^\S+@\S+\.\S+$/.test(recipient.email)||/[\r\n]/.test(recipient.email)||!["ja","en"].includes(recipient.locale))throw new Error("Invalid verified recipient");
     const digest=row.payload.digest as Digest;
     if(!digest||digest.clerkUserId!==userId||digest.idempotencyKey!==key)throw new Error("Digest identity mismatch");
     message=renderAlertMail({locale:recipient.locale,date:digest.payload.date,items:digest.payload.items,...safeLinks(await deps.links(userId),deps.publicOrigin)});
     const claimed=await claimAlertReservation(client,userId,task,deps.provider.name);
     if(claimed)attemptedAt=(await client.query("SELECT payload->'reservation'->>'attemptedAt' AS at FROM resolute.notification_outbox WHERE clerk_user_id=$1 AND idempotency_key=$2",[userId,key])).rows[0]?.at;
     return claimed;
    },
    send:async()=>{
     if(!recipient||!message)throw new Error("Mail preparation missing");
     receipt=await deps.provider.send({key,to:recipient.email,mail:message},AbortSignal.timeout(15000));
     if(!validReceipt(receipt,key,attemptedAt,clock()))throw new Error("Unconfirmed acceptance");
     return "accepted";
    },
    // Use the provider's original receipt time, not retry time or dispatch's clock.
    acknowledge:async()=>{if(!receipt)throw new Error("Missing receipt");await acknowledge(receipt);}
   }).catch(async(error)=>{
    const state=(await client.query("SELECT payload->'reservation'->>'status' AS status FROM resolute.notification_outbox WHERE clerk_user_id=$1 AND idempotency_key=$2",[userId,key])).rows[0]?.status;
    if(state==="attempting")return "uncertain";
    throw error;
   });
   return result;
  }finally{
   if(locked){try{await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))",[userId]);}catch{discard=true;}}
   client.release(discard);
  }
 };
}
