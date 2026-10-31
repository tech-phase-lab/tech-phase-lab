import {hasOwnerAccess,type OwnerAccess} from './owner-access.ts';
import { resolveResoluteEntitlements, type EntitlementRecord } from "./entitlements.ts";
import { parseNotificationSettings, type NotificationSettings } from "./notification-settings.ts";
import { jstSlot } from "./notification-job.ts";

export type QueuedNotification = {key:string;kind:"alerts"|"morning";deliveryDateJst:string;settingsRevision:number;ruleKey:string;acceptedAt:string|null};
type DispatchContext={userId?:string;ownerAccess?:OwnerAccess;settings:NotificationSettings;revision:number;ruleKey:string;entitlements:EntitlementRecord[];
 recipientVerified:boolean;preferencesConfigured:boolean;unsubscribed:boolean;planExists:boolean};
/** Call under the shared user lock. Provider adapter MUST honor task.key as an idempotency key.
 * Settings/rights/recipient are re-read immediately before sending. No retries are made here.
 * A lost response must be reconciled with the provider before acknowledging or retrying.
 * There is deliberately no provider configuration or enabled cron in this module.
 */
export async function dispatchNotification(task:QueuedNotification,deps:{
 deliveryEnabled:boolean;now:()=>Date;read:()=>Promise<DispatchContext>;
 send:(idempotencyKey:string)=>Promise<"accepted"|"duplicate">;
 acknowledge:(acceptedAt:string)=>Promise<void>;
 // Persist the attempt under the same lock before sending. Missing claims fail closed.
 claimAlert?:()=>Promise<boolean>;
}) {
 if(!deps.deliveryEnabled)return "disabled";
 if(task.acceptedAt!==null)return "already-accepted";
 const c=await deps.read(),settings=parseNotificationSettings(c.settings),now=deps.now(),slot=jstSlot(now);
 if(!(hasOwnerAccess(c.ownerAccess,c.userId??'',now.getTime())&&task.key.startsWith(c.userId+':')||resolveResoluteEntitlements(c.entitlements,now.toISOString()).canReceiveNotifications)||
  !c.recipientVerified||!c.preferencesConfigured||c.unsubscribed||c.revision!==task.settingsRevision||
  c.ruleKey!==task.ruleKey||slot.date!==task.deliveryDateJst||slot.hour!==settings.deliveryHourJst||
  (task.kind==="alerts"?(!settings.alertsEnabled||!c.planExists):!settings.morningEnabled))return "suppressed";
 if(task.kind==="alerts"&&(!deps.claimAlert||!await deps.claimAlert()))return "unclaimed";
 const result=await deps.send(task.key);
 if(result==="accepted")await deps.acknowledge(deps.now().toISOString());
 return result;
}
