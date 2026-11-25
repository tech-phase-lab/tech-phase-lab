import { parseNotificationMutation, parseNotificationSnapshot, type NotificationSettings } from "./notification-settings.ts";
import { notificationJson } from "./notification-json.ts";
import { NOTIFICATION_DELIVERY_HEADER } from "./notification-delivery-state.ts";
export { NotificationHttpError } from "./notification-json.ts";
export async function readNotificationMutation(request:Request) { return parseNotificationMutation(await notificationJson(request)); }
export async function fetchNotificationSettings(token:string,base:string|undefined,secret:string|undefined,method:"GET"|"PUT",
 mutation?:{settings:NotificationSettings;baseRevision:number},fetcher:typeof fetch=fetch) {
 if(!base||!secret||secret.length<43||!token||token.length>16384)throw new Error("Unavailable");
 const url=new URL(base);
 if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.pathname!=="/"||!url.hostname.endsWith(".up.railway.app"))throw new Error("Unavailable");
 url.pathname="/internal/v1/notification-settings";
 const response=await fetcher(url,{method,cache:"no-store",redirect:"error",signal:AbortSignal.timeout(20000),
  headers:{Authorization:`Bearer ${token}`,"X-Resolute-Service-Token":secret,"Content-Type":"application/json"},
  body:method==="PUT"?JSON.stringify(parseNotificationMutation(mutation)):undefined});
 const body=await notificationJson(response);
 // Delivery state travels in a header, so an older frontend (strict body) and an older resolute-api (no header) both keep working.
 if([200,409].includes(response.status)){const snapshot=parseNotificationSnapshot(body);const {delivery:_ignored,...saved}=snapshot;
  return {status:response.status,body:response.headers.get(NOTIFICATION_DELIVERY_HEADER)==="on"?{...saved,delivery:true as const}:saved};}
 const errors:Record<number,string>={400:"INVALID_NOTIFICATION_SETTINGS",401:"AUTH_REQUIRED",403:"NOTIFICATION_ACCESS_DENIED",413:"BODY_TOO_LARGE",415:"JSON_REQUIRED",429:"RATE_LIMITED",503:"NOTIFICATION_UNAVAILABLE"};
 if(!errors[response.status]||body?.error!==errors[response.status])throw new Error("Unavailable");
 return {status:response.status,body:{error:errors[response.status]}};
}
