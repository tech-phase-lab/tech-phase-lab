import { parsePlanMutation, parsePlanSnapshot, type PlanSnapshot } from "./plan-data.ts";
import { PlanClientError, type requestPlan } from "./plan-client.ts";
import { defaultNotificationSettings, parseNotificationMutation, parseNotificationSnapshot, type NotificationSnapshot } from "./notification-settings.ts";
import { NotificationClientError, type requestNotificationSettings } from "./notification-client.ts";

export const REVIEW_STORAGE_KEY = "resolute-owner-review-v1";
type ReviewStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** Owner-only sandbox. Optional device persistence; never calls production APIs. */
export function createReviewStore(storage?: ReviewStorage) {
 let plan: PlanSnapshot = { plan: null, revision: 0 };
 let notification: NotificationSnapshot = { settings: defaultNotificationSettings(), revision: 0 };
 let persistence = { remembered: false, error: false };
 const listeners = new Set<() => void>();
 const notify = (remembered: boolean, error = false) => {
  persistence = { remembered, error }; listeners.forEach(listener => listener());
 };
 try {
  const raw = storage?.getItem(REVIEW_STORAGE_KEY);
  if (raw) {
   if (raw.length > 50000) throw new Error("INVALID_REVIEW");
   const saved = JSON.parse(raw);
   if (saved.version !== 1) throw new Error("INVALID_REVIEW");
   const restoredPlan = parsePlanSnapshot(saved.plan);
   const restoredNotification = parseNotificationSnapshot(saved.notification);
   plan = restoredPlan; notification = restoredNotification;
   persistence = { remembered: true, error: false };
  }
 } catch { persistence = { remembered: false, error: true }; }
 const persist = () => {
  if (!persistence.remembered) return;
  try {
   if (!storage) throw new Error("NO_STORAGE");
   storage.setItem(REVIEW_STORAGE_KEY, JSON.stringify({ version: 1, plan, notification }));
  } catch { notify(false, true); }
 };
 const setRemembered = (value: boolean) => {
  if (value) { notify(true); persist(); }
  else {
   try {
    if (!storage) throw new Error("NO_STORAGE");
    storage.removeItem(REVIEW_STORAGE_KEY); notify(false);
   } catch { notify(persistence.remembered, true); }
  }
 };
 const readPlan: typeof requestPlan = async (mutation, signal) => {
  if (signal?.aborted) throw new PlanClientError("unavailable");
  if (mutation) {
   let parsed; try { parsed = parsePlanMutation("PUT", mutation); } catch { throw new PlanClientError("invalid"); }
   if (parsed.baseRevision !== plan.revision) throw new PlanClientError("conflict", structuredClone(plan));
   const time = new Date().toISOString();
   plan = { plan: { ...parsed.plan!, createdAt: plan.plan?.createdAt ?? time, updatedAt: time }, revision: plan.revision + 1 };
   persist();
  }
  return structuredClone(plan);
 };
 const readNotifications: typeof requestNotificationSettings = async (mutation, signal) => {
  if (signal?.aborted) throw new NotificationClientError(503);
  if (mutation) {
   let parsed; try { parsed = parseNotificationMutation(mutation); } catch { throw new NotificationClientError(400); }
   if (parsed.baseRevision !== notification.revision) throw new NotificationClientError(409);
   notification = { settings: parsed.settings, revision: notification.revision + 1 };
   persist();
  }
  return structuredClone(notification);
 };
 return { requestPlan: readPlan, requestNotificationSettings: readNotifications, setRemembered,
  getPersistence: () => persistence,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }
 };
}
