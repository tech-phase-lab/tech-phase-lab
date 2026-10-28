import { NotificationInputError } from "./notification-settings.ts";
import { NotificationHttpError, readNotificationMutation, fetchNotificationSettings } from "./notification-http.ts";
const headers={"Cache-Control":"private, no-store",Vary:"Cookie","X-Content-Type-Options":"nosniff"};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:status===429?{...headers,"Retry-After":"60"}:headers});
export function createNotificationRoutes(services:{session:()=>Promise<string|null>;forward:(token:string,method:"GET"|"PUT",mutation?:Awaited<ReturnType<typeof readNotificationMutation>>)=>ReturnType<typeof fetchNotificationSettings>}) {
 const handle=async(request:Request,method:"GET"|"PUT")=>{
  if(new URL(request.url).search)return json({error:"INVALID_NOTIFICATION_SETTINGS"},400);
  if(method==="PUT"&&request.headers.get("origin")!==new URL(request.url).origin)return json({error:"ORIGIN_REJECTED"},403);
  try{const token=await services.session();if(!token)return json({error:"AUTH_REQUIRED"},401);
   const result=await services.forward(token,method,method==="PUT"?await readNotificationMutation(request):undefined);
   return json(result.body,result.status);
  }catch(e){if(e instanceof NotificationInputError)return json({error:"INVALID_NOTIFICATION_SETTINGS"},400);
   if(e instanceof NotificationHttpError)return json({error:e.status===413?"BODY_TOO_LARGE":e.status===415?"JSON_REQUIRED":"INVALID_NOTIFICATION_SETTINGS"},e.status);
   return json({error:"NOTIFICATION_UNAVAILABLE"},503);}
 };
 return {GET:(r:Request)=>handle(r,"GET"),PUT:(r:Request)=>handle(r,"PUT")};
}
