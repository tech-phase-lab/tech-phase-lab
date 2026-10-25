import { Pool } from "pg";
import { createMailStopTokens, InvalidStopToken } from "./notification-stop-token.ts";
import { createMailStopStore } from "./notification-stop-store.ts";
import { notificationJson, NotificationHttpError } from "./notification-json.ts";
import { protectionRuntime } from "./protection-runtime.ts";
import { resoluteDatabaseConfig } from "./database-config.ts";

const reply=(body:unknown,status:number)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
export function createMailStopService(verify:(token:unknown)=>{userId:string},stop:(userId:string)=>Promise<{stopped:true}>) {
 return async(request:Request)=>{
  if(request.method!=="POST")return reply({error:"METHOD_NOT_ALLOWED"},405);
  try{
   const body=await notificationJson(request);
   if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).length!==1||!Object.hasOwn(body,"token"))throw new InvalidStopToken();
   const {userId}=verify(body.token);await stop(userId);return reply({stopped:true},200);
  }catch(e){
   if(e instanceof InvalidStopToken)return reply({error:"INVALID_STOP_LINK"},400);
   if(e instanceof NotificationHttpError)return reply({error:"INVALID_STOP_REQUEST"},e.status);
   return reply({error:"STOP_UNAVAILABLE"},503);
  }
 };
}
let handler:ReturnType<typeof createMailStopService>|undefined;
export async function mailStopRequest(request:Request) {
 if(process.env.RESOLUTE_MAIL_STOP_ENABLED!=="true")return reply({error:"STOP_UNAVAILABLE"},503);
 try{
  if(!handler){
   const hex=process.env.RESOLUTE_MAIL_STOP_KEY_HEX;
   if(!hex||!/^[a-f0-9]{64}$/.test(hex)||hex===process.env.RESOLUTE_PROTECTION_KEY_HEX)throw new Error("Dedicated mail stop key required");
   const config=resoluteDatabaseConfig(process.env.RESOLUTE_NOTIFICATION_DB_URL);
   if(new URL(config.connectionString).username!=="resolute_notification_writer")throw new Error("Scoped writer required");
   const protect=protectionRuntime();
   const pool=new Pool(config);pool.on("error",()=>{});
   handler=createMailStopService(createMailStopTokens(Buffer.from(hex,"hex")).verify,createMailStopStore(pool,protect));
  }
  return await handler(request);
 }catch{return reply({error:"STOP_UNAVAILABLE"},503);}
}
