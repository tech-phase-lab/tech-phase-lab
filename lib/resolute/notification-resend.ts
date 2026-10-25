import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { AlertProvider, AlertReceipt } from "./notification-delivery.ts";

// Official contract: resend.com/docs/api-reference/emails/{send-email,retrieve-email}
// Resend's 24h idempotency window is NOT permission to retry an uncertain attempt.
// Call only behind createAlertDelivery's durable claim; lookup is always GET-only.
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const email=(v:unknown):v is string=>typeof v==="string"&&v.length<=320&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v);
type Reference={id:string;recipientHash:string};
export type ResendStatus="sent"|"delivered"|"delivery_delayed"|"bounced"|"failed"|"complained"|"suppressed"|"unknown";
export type ResendObservation={status:ResendStatus;checkedAt:string;acceptedAt:string};
export type ResendEvidence={
 read:(key:string)=>Promise<Reference|null>;
 bind:(key:string,reference:Reference)=>Promise<void>;
 observe:(key:string,id:string,result:ResendObservation)=>Promise<void>;
};
const statuses=new Set<ResendStatus>(["sent","delivered","delivery_delayed","bounced","failed","complained","suppressed"]);
const unavailable=()=>new Error("Mail provider unavailable");
async function json(response:Response) {
 if(response.status!==200||response.headers.get("content-type")?.split(";",1)[0].trim()!=="application/json"){
  await response.body?.cancel();throw unavailable();
 }
 const reader=response.body?.getReader();if(!reader)throw unavailable();
 let size=0,text="";const decoder=new TextDecoder("utf-8",{fatal:true});
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>262144)throw unavailable();text+=decoder.decode(part.value,{stream:true});}
  const value=JSON.parse(text+decoder.decode());if(!value||typeof value!=="object"||Array.isArray(value))throw unavailable();return value;
 }finally{await reader.cancel();reader.releaseLock();}
}
function acceptedTime(value:unknown) {
 // API uses PostgreSQL timestamptz strings as well as ISO timestamps.
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value))throw unavailable();
 let normalized=value.replace(" ","T").replace(/([+-]\d{2})$/,"$1:00").replace(/([+-]\d{2})(\d{2})$/,"$1:$2");
 normalized=normalized.replace(/\.(\d{3})\d+/,'\.$1');
 const millis=Date.parse(normalized);if(!Number.isFinite(millis))throw unavailable();return new Date(millis).toISOString();
}
export function createResendAlertProvider(config:{apiKey:string;from:string;enabled?:boolean},evidence:ResendEvidence,request:typeof fetch=fetch,now:()=>Date=()=>new Date()):AlertProvider&{inspect:(key:string,signal:AbortSignal)=>Promise<ResendObservation|null>} {
 if(!/^re_[A-Za-z0-9_-]{10,200}$/.test(config.apiKey)||!email(config.from))throw unavailable();
 const checkKey=(key:string)=>{if(!/^user_[A-Za-z0-9]{1,128}:\d{4}-\d{2}-\d{2}:alerts$/.test(key))throw unavailable();};
 const api=async(path:string,signal:AbortSignal,body?:unknown,idempotency?:string)=>{
  if(!config.enabled)throw unavailable();signal.throwIfAborted();
  return json(await request("https://api.resend.com"+path,{method:body?"POST":"GET",redirect:"error",cache:"no-store",
   signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),headers:{Authorization:"Bearer "+config.apiKey,"Content-Type":"application/json",...(idempotency?{"Idempotency-Key":idempotency}:{})},...(body?{body:JSON.stringify(body)}:{})}));
 };
 const inspect=async(key:string,signal:AbortSignal):Promise<ResendObservation|null>=>{
  try{
   if(!config.enabled)throw unavailable();checkKey(key);
   const ref=await evidence.read(key);if(!ref)return null;
   if(!uuid(ref.id)||!/^[a-f0-9]{64}$/.test(ref.recipientHash))throw unavailable();
   const data=await api('/emails/'+ref.id,signal);
   const tags=Array.isArray(data.tags)?data.tags:[];
   if(data.id!==ref.id||data.object!=="email"||data.from!==config.from||!Array.isArray(data.to)||data.to.length!==1||!email(data.to[0])||hash(data.to[0])!==ref.recipientHash||
    !Array.isArray(data.cc)||data.cc.length||!Array.isArray(data.bcc)||data.bcc.length||data.scheduled_at!=null||
    tags.filter((t:{name?:unknown;value?:unknown})=>t?.name==='resolute_key').length!==1||!tags.some((t:{name?:unknown;value?:unknown})=>t?.name==='resolute_key'&&t.value===hash(key)))throw unavailable();
   const acceptedAt=acceptedTime(data.created_at),checkedAt=now().toISOString();if(acceptedAt>checkedAt)throw unavailable();
   // Delivered means recipient SERVER accepted it, not inbox placement or reading.
   // Opens/clicks (including scanners) are not substituted for a delivery receipt.
   const status:ResendStatus=statuses.has(data.last_event)?data.last_event:"unknown";
   const result={status,checkedAt,acceptedAt};await evidence.observe(key,ref.id,result);return result;
  }catch{throw unavailable();}
 };
 const lookup=async(key:string,signal:AbortSignal):Promise<AlertReceipt|null>=>{
  const result=await inspect(key,signal);if(!result)return null;
  const ref=await evidence.read(key);if(!ref)throw unavailable();
  return {key,messageId:ref.id,acceptedAt:result.acceptedAt};
 };
 return {name:"resend",inspect,lookup,async send(input,signal){
  try{
   if(!config.enabled)throw unavailable();checkKey(input.key);signal.throwIfAborted();
   if(!email(input.to)||!input.mail||typeof input.mail.subject!=="string"||!input.mail.subject||input.mail.subject.length>998||/[\r\n]/.test(input.mail.subject)||typeof input.mail.text!=="string"||!input.mail.text||Buffer.byteLength(input.mail.text)>60000)throw unavailable();
   const existing=await evidence.read(input.key);
   if(existing){if(existing.recipientHash!==hash(input.to))throw unavailable();return await lookup(input.key,signal);}
   const data=await api('/emails',signal,{from:config.from,to:[input.to],subject:input.mail.subject,text:input.mail.text,tags:[{name:'resolute_key',value:hash(input.key)}]},'resolute-'+hash(input.key));
   if(!uuid(data.id))throw unavailable();
   // Persist provider ID BEFORE receipt retrieval. A GET/ack outage can resume
   // by ID without POSTing again, including after Resend's 24-hour key expiry.
   await evidence.bind(input.key,{id:data.id,recipientHash:hash(input.to)});
   return await lookup(input.key,signal);
  }catch{throw unavailable();}
 }};
}

/** Bound to the sender's existing connection and user lock. No DDL, new role,
 * migration, plaintext address, mail body, credentials, or automatic scheduling.
 */
export function resendOutboxEvidence(db:Pick<PoolClient,"query">,userId:string):ResendEvidence {
 const valid=(key:string)=>{if(!/^user_[A-Za-z0-9]{1,128}$/.test(userId)||!key.startsWith(userId+":"))throw unavailable();};
 return {
  async read(key){valid(key);const row=(await db.query(`SELECT payload->'resend' AS ref FROM resolute.notification_outbox
   WHERE clerk_user_id=$1 AND idempotency_key=$2 AND kind='alerts'
   AND payload->'reservation'->>'provider'='resend' AND payload->'reservation'->>'status'='attempting'`,[userId,key])).rows[0];return row?.ref??null;},
  async bind(key,ref){valid(key);if(!uuid(ref.id)||!/^[a-f0-9]{64}$/.test(ref.recipientHash))throw unavailable();
   const r=await db.query(`UPDATE resolute.notification_outbox SET payload=jsonb_set(payload,'{resend}',$3::jsonb)
    WHERE clerk_user_id=$1 AND idempotency_key=$2 AND kind='alerts' AND accepted_at IS NULL
    AND payload->'reservation'->>'provider'='resend' AND payload->'reservation'->>'status'='attempting'
    AND (NOT(payload?'resend') OR payload->'resend'=$3::jsonb) RETURNING idempotency_key`,[userId,key,JSON.stringify(ref)]);
   if(r.rowCount!==1)throw unavailable();},
  async observe(key,id,result){valid(key);
   const r=await db.query(`UPDATE resolute.notification_outbox SET payload=jsonb_set(payload,'{resendStatus}',$4::jsonb)
    WHERE clerk_user_id=$1 AND idempotency_key=$2 AND kind='alerts'
    AND payload->'reservation'->>'provider'='resend' AND payload->'reservation'->>'status'='attempting'
    AND payload->'resend'->>'id'=$3
    AND (payload->'resendStatus'->>'checkedAt' IS NULL OR payload->'resendStatus'->>'checkedAt'<=$5)
    RETURNING idempotency_key`,[userId,key,id,JSON.stringify(result),result.checkedAt]);
   if(r.rowCount!==1)throw unavailable();}
 };
}
