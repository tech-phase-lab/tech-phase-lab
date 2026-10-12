import { resolveResoluteEntitlements, type EntitlementRecord } from "./entitlements.ts";
import { parseNotificationSettings, type NotificationSettings } from "./notification-settings.ts";
import { jstSlot } from "./notification-job.ts";

export type QueuedNotification = {key:string;kind:"alerts"|"morning";deliveryDateJst:string;settingsRevision:number;ruleKey:string;acceptedAt:string|null};
type DispatchContext={settings:NotificationSettings;revision:number;ruleKey:string;entitlements:EntitlementRecord[];
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
}) {
 if(!deps.deliveryEnabled)return "disabled";
 if(task.acceptedAt!==null)return "already-accepted";
 const c=await deps.read(),settings=parseNotificationSettings(c.settings),now=deps.now(),slot=jstSlot(now);
 if(!resolveResoluteEntitlements(c.entitlements,now.toISOString()).canReceiveNotifications||
  !c.recipientVerified||!c.preferencesConfigured||c.unsubscribed||c.revision!==task.settingsRevision||
  c.ruleKey!==task.ruleKey||slot.date!==task.deliveryDateJst||slot.hour!==settings.deliveryHourJst||
  (task.kind==="alerts"?(!settings.alertsEnabled||!c.planExists):!settings.morningEnabled))return "suppressed";
 const result=await deps.send(task.key);
 if(result==="accepted")await deps.acknowledge(deps.now().toISOString());
 return result;
}
