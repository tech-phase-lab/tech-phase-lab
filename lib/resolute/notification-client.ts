import { parseNotificationMutation, parseNotificationSnapshot, type NotificationSettings } from "./notification-settings.ts";
import { notificationJson } from "./notification-json.ts";
import { etDay } from "../research/stock-splits.ts";
import { forget, remember } from "./view-memory.ts";
export class NotificationClientError extends Error {
 readonly status:number;
 constructor(status:number){super("Notification request failed");this.status=status;}
}
/** The saved settings are compared with what was sent without the price days: the server may bring a day in the future back to today. */
const comparable=(s:NotificationSettings)=>JSON.stringify({...s,watchItems:s.watchItems.map(i=>({symbol:i.symbol,referencePrice:i.referencePrice}))});
export async function requestNotificationSettings(mutation?:{settings:NotificationSettings;baseRevision:number},signal?:AbortSignal,fetcher:typeof fetch=fetch) {
 try {
  // A reference price typed on this screen is on today's basis (stock splits, notification-splits.ts); one loaded keeps its day.
  if(mutation){const day=etDay();mutation={...mutation,settings:{...mutation.settings,watchItems:mutation.settings.watchItems.map(i=>i.priceDay?i:{...i,priceDay:day})}};}
  const timeout=AbortSignal.timeout(25000);
  const response=await fetcher("/api/resolute/notification-settings",{method:mutation?"PUT":"GET",cache:"no-store",credentials:"same-origin",redirect:"error",
   signal:signal?AbortSignal.any([signal,timeout]):timeout,...(mutation?{headers:{"Content-Type":"application/json"},body:JSON.stringify(parseNotificationMutation(mutation))}:{})});
  if(response.status===401||response.status===403)forget("notifications");
  if(response.status!==200)throw new NotificationClientError(response.status);
  const saved=parseNotificationSnapshot(await notificationJson(response));
  if(mutation&&(saved.revision!==mutation.baseRevision+1||comparable(saved.settings)!==comparable(parseNotificationMutation(mutation).settings)))throw new NotificationClientError(503);
  remember("notifications",saved);
  return saved;
 }catch(e){if(e instanceof NotificationClientError)throw e;throw new NotificationClientError(503);}
}
