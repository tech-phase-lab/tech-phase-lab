import { emptyDiagnosisDraft, draftToPlan } from "./diagnosis-form.ts";
import { parsePlanMutation, type PlanSnapshot } from "./plan-data.ts";
import { PlanClientError, type requestPlan } from "./plan-client.ts";
import { defaultNotificationSettings, parseNotificationMutation, type NotificationSnapshot } from "./notification-settings.ts";
import { NotificationClientError, type requestNotificationSettings } from "./notification-client.ts";

/** Browser-memory-only sample workspace. No fetch, storage, DB, or email side effects. */
export function createReviewStore() {
 const draft = emptyDiagnosisDraft();
 Object.assign(draft.answers, { q01:"first",q02:"l25",q03:"stable",q04:"m6",q05:"m6",q06:"none",
  q07:"input",q08:"input",q09:"y10plus",q10:"rarely",q11:"p20",q12:"no",q13:"wait",q14:"never",
  q15:"hold",q16:"steady",q17:"monthly",q18:"weekly",q19:"never",q20:"fund_etf",q22:"p20",
  q23:"none",q24:"steps3",q25:"d10",q26:"b5",q27:"equal",q28:["cash_low"],q29:["over_tolerance"],q30:"ignore" });
 draft.numbers = { q07:"10000000", q08:"3000000" };
 const now = new Date().toISOString();
 let plan: PlanSnapshot = { plan: { ...draftToPlan(draft), createdAt: now, updatedAt: now }, revision: 1 };
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
