import { parsePlanMutation, type PlanSnapshot } from "./plan-data.ts";
import { PlanClientError, type requestPlan } from "./plan-client.ts";
import { defaultNotificationSettings, parseNotificationMutation, type NotificationSnapshot } from "./notification-settings.ts";
import { NotificationClientError, type requestNotificationSettings } from "./notification-client.ts";

/** Browser-memory-only review workspace. No fetch, storage, DB, or email side effects. */
export function createReviewStore() {
 let plan: PlanSnapshot = { plan: null, revision: 0 };
 let notification: NotificationSnapshot = { settings: defaultNotificationSettings(), revision: 0 };
 const readPlan: typeof requestPlan = async (mutation, signal) => {
  if (signal?.aborted) throw new PlanClientError("unavailable");
  if (mutation) {
   let parsed; try { parsed = parsePlanMutation("PUT", mutation); } catch { throw new PlanClientError("invalid"); }
   if (parsed.baseRevision !== plan.revision) throw new PlanClientError("conflict", structuredClone(plan));
   const time = new Date().toISOString();
   plan = { plan: { ...parsed.plan!, createdAt: plan.plan?.createdAt ?? time, updatedAt: time }, revision: plan.revision + 1 };
  }
  return structuredClone(plan);
 };
 const readNotifications: typeof requestNotificationSettings = async (mutation, signal) => {
  if (signal?.aborted) throw new NotificationClientError(503);
  if (mutation) {
   let parsed; try { parsed = parseNotificationMutation(mutation); } catch { throw new NotificationClientError(400); }
   if (parsed.baseRevision !== notification.revision) throw new NotificationClientError(409);
   notification = { settings: parsed.settings, revision: notification.revision + 1 };
  }
  return structuredClone(notification);
 };
 return { requestPlan: readPlan, requestNotificationSettings: readNotifications };
}
