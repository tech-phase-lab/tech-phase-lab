import { parseNotificationMutation, parseNotificationSnapshot, type NotificationSettings } from "./notification-settings.ts";
import { notificationJson } from "./notification-json.ts";
export class NotificationClientError extends Error {
 readonly status:number;
 constructor(status:number){super("Notification request failed");this.status=status;}
}
export async function requestNotificationSettings(mutation?:{settings:NotificationSettings;baseRevision:number},signal?:AbortSignal,fetcher:typeof fetch=fetch) {
 try {
  const timeout=AbortSignal.timeout(25000);
  const response=await fetcher("/api/resolute/notification-settings",{method:mutation?"PUT":"GET",cache:"no-store",credentials:"same-origin",redirect:"error",
   signal:signal?AbortSignal.any([signal,timeout]):timeout,...(mutation?{headers:{"Content-Type":"application/json"},body:JSON.stringify(parseNotificationMutation(mutation))}:{})});
  if(response.status!==200)throw new NotificationClientError(response.status);
  const saved=parseNotificationSnapshot(await notificationJson(response));
  if(mutation&&(saved.revision!==mutation.baseRevision+1||JSON.stringify(saved.settings)!==JSON.stringify(parseNotificationMutation(mutation).settings)))throw new NotificationClientError(503);
  return saved;
 }catch(e){if(e instanceof NotificationClientError)throw e;throw new NotificationClientError(503);}
}
