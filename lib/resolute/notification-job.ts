import { judge, buildDigest, type Close, type NotifiedState, type Digest } from "./alert-judge.ts";
import { parseNotificationSettings, type NotificationSettings } from "./notification-settings.ts";
import { resolveResoluteEntitlements, type EntitlementRecord } from "./entitlements.ts";
import type { PlanInput } from "./plan-data.ts";

// JST 07:00, 08:00, 09:00, 10:00. No cron is provisioned by this module.
export const NOTIFICATION_CRON_UTC = "0 0,1,22,23 * * *";
export function jstSlot(now:Date) {
 if(!Number.isFinite(now.getTime()))throw new Error("Invalid clock");
 const jst=new Date(now.getTime()+9*3600000);
 return {date:jst.toISOString().slice(0,10),hour:jst.getUTCHours()};
}
function nextDate(date:string) { return new Date(Date.parse(date+"T00:00:00Z")+86400000).toISOString().slice(0,10); }
function validDate(date:string) {return /^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;}
export type ConfirmedAlert = { id:string; acceptedAt:string };
export type NotificationContext = {
 settings:NotificationSettings; entitlements:EntitlementRecord[]; plan:PlanInput|null;
 locale:"ja"|"en"; preferencesConfigured:boolean; recipientVerified:boolean; unsubscribed:boolean;
 marketDate:string; closes:Close[]; state:NotifiedState; lastConfirmedAlert:ConfirmedAlert|null;
};
export type NotificationTask =
 | {kind:"alerts";key:string;deliveryDateJst:string;digest:Digest;nextState:NotifiedState}
 | {kind:"morning";key:string;deliveryDateJst:string;locale:"ja"|"en";sourceAlertId:string};
export function prepareNotificationSlot(userId:string,now:Date,c:NotificationContext):NotificationTask[] {
 if(!/^user_[A-Za-z0-9]{1,128}$/.test(userId))throw new Error("Invalid identity");
 const settings=parseNotificationSettings(c.settings),slot=jstSlot(now);
 const rights=resolveResoluteEntitlements(c.entitlements,now.toISOString());
 if(!rights.canReceiveNotifications||!c.preferencesConfigured||!c.recipientVerified||c.unsubscribed||slot.hour!==settings.deliveryHourJst)return [];
 const tasks:NotificationTask[]=[];
 // Only a confirmed accepted alert creates a next-day follow-up. No daily generic mail.
 const source=c.lastConfirmedAlert;
 if(settings.morningEnabled&&source&&Number.isFinite(Date.parse(source.acceptedAt))&&Date.parse(source.acceptedAt)<=now.getTime()) {
  const sourceDate=jstSlot(new Date(source.acceptedAt)).date;
  if(slot.date===nextDate(sourceDate))tasks.push({kind:"morning",key:`${userId}:${slot.date}:morning`,deliveryDateJst:slot.date,locale:c.locale,sourceAlertId:source.id});
 }
 if(!settings.alertsEnabled||!c.plan||!validDate(c.marketDate)||c.marketDate>=slot.date)return tasks;
 // Retain the most recent applicable market session supplied by the data adapter. Do not infer holidays/finality.
 const closes=c.closes.filter(x=>x.date===c.marketDate);
 if(new Set(closes.map(x=>x.symbol)).size!==closes.length)throw new Error("Ambiguous closes");
 const items=settings.watchItems.map(i=>({...i,lines:c.plan!.buyLines.map(l=>l.dropPct),
  renotifyAfterRecovery:false,...(settings.surgeCapPct===null?{}:{surgeCapPct:settings.surgeCapPct})}));
 const result=judge(items,closes,c.state);
 const digest=buildDigest({userId,date:c.marketDate,locale:c.locale,events:result.events});
 if(digest) {
  const key=`${userId}:${slot.date}:alerts`;
  tasks.push({kind:"alerts",key,deliveryDateJst:slot.date,digest:{...digest,idempotencyKey:key},nextState:result.nextState});
 }
 return tasks;
}
/** Adapter contract: serialize by user across scheduler runs, settings and entitlement changes.
 * enqueue must atomically insert a durable unique task and save nextState only for a NEW alert task.
 * duplicate/failed/uncertain attempts MUST NOT change state or create a confirmed-alert receipt.
 * The actual sender must re-read settings, rights, verified recipient and unsubscribe immediately before dispatch.
 * Resolve email from the verified account at dispatch; never persist it with plans or settings.
 */
export async function runNotificationSlot(userId:string,deps:{
 now:()=>Date;
 withUserLock:<T>(userId:string,run:()=>Promise<T>)=>Promise<T>;
 read:(userId:string)=>Promise<NotificationContext>;
 enqueue:(userId:string,task:NotificationTask)=>Promise<"queued"|"duplicate">;
}) {
 return deps.withUserLock(userId,async()=>{
  const context=await deps.read(userId);
  const tasks=prepareNotificationSlot(userId,deps.now(),context);
  const results: {kind:NotificationTask["kind"];status:"queued"|"duplicate"}[]=[];
  for(const task of tasks)results.push({kind:task.kind,status:await deps.enqueue(userId,task)});
  return results;
 });
}
