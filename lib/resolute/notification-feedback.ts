import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const events=new Set(['sent','delivered','delivery_delayed','bounced','failed','complained','suppressed']);
export type MailFeedback={eventId:string;id:string;correlation:string;recipientHash:string;fromHash:string;status:string;occurredAt:string;acceptedAt:string};
export class InvalidMailFeedback extends Error {constructor(){super('Invalid mail feedback');}}
const invalid=()=>new InvalidMailFeedback();
function timestamp(value:unknown){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw invalid();
 return new Date(value).toISOString();
}
/** Raw-byte Svix HMAC contract; no JSON parsing before signature verification.
 * docs.svix.com/receiving/verifying-payloads/how-manual
 */
export function verifyMailFeedback(raw:Uint8Array,headers:Headers,secret:string,now:Date) {
 const id=headers.get('svix-id')??'',time=headers.get('svix-timestamp')??'',signatures=headers.get('svix-signature')??'';
 if(!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)||secret.length>200||!/^msg_[A-Za-z0-9_-]{1,128}$/.test(id)||!/^\d{1,12}$/.test(time)||signatures.length>2048||raw.byteLength>65536||
  !Number.isFinite(now.getTime())||Math.abs(now.getTime()/1000-Number(time))>300)throw invalid();
 const key=Buffer.from(secret.slice(6),'base64');if(key.length<16||key.toString('base64').replace(/=+$/,'')!==secret.slice(6).replace(/=+$/,''))throw invalid();
 const expected=createHmac('sha256',key).update(id+'.'+time+'.').update(raw).digest();
 const valid=signatures.split(' ').some(part=>{if(!/^v1,[A-Za-z0-9+/]{43}=$/.test(part))return false;const v=Buffer.from(part.slice(3),'base64');return v.length===expected.length&&timingSafeEqual(expected,v);});
 if(!valid)throw invalid();
 try{return {eventId:id,body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};}catch{throw invalid();}
}
export function parseMailFeedback(eventId:string,body:unknown,from:string,now:Date):MailFeedback|null {
 if(!body||typeof body!=='object'||Array.isArray(body))throw invalid();
 const p=body as Record<string,unknown>;
 if(typeof p.type!=='string')throw invalid();
 if(!events.has(p.type.replace(/^email\./,''))||!p.type.startsWith('email.'))return null;
 const d=p.data as Record<string,unknown>;
 if(!d||typeof d!=='object'||Array.isArray(d)||d.from!==from||!Array.isArray(d.to)||d.to.length!==1||typeof d.to[0]!=='string'||d.to[0].length>320||!/^\S+@\S+\.\S+$/.test(d.to[0])||/[\r\n<>]/.test(d.to[0])||
  typeof d.email_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(d.email_id)||
  (d.cc!==undefined&&(!Array.isArray(d.cc)||d.cc.length))||(d.bcc!==undefined&&(!Array.isArray(d.bcc)||d.bcc.length)))throw invalid();
 const tags=d.tags as Record<string,unknown>;
 // Other product emails on this account are not RESOLUTE feedback.
 if(!tags||typeof tags!=='object'||Array.isArray(tags)||!Object.hasOwn(tags,'resolute_key'))return null;
 if(typeof tags.resolute_key!=='string'||!/^[a-f0-9]{64}$/.test(tags.resolute_key))throw invalid();
 const acceptedAt=timestamp(d.created_at),occurredAt=timestamp(p.created_at);
 if(acceptedAt>occurredAt||Date.parse(occurredAt)>now.getTime())throw invalid();
 return {eventId,id:d.email_id,correlation:tags.resolute_key,recipientHash:hash(d.to[0]),fromHash:hash(from),status:p.type.slice(6),occurredAt,acceptedAt};
}
export function createMailFeedbackStore(pool:Pick<Pool,'connect'>){
 return async(event:MailFeedback)=>{
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   const candidates=(await c.query(`SELECT clerk_user_id,idempotency_key FROM resolute.notification_outbox
    WHERE kind='alerts' AND payload->'resendAttempt'->>'correlation'=$1 LIMIT 2`,[event.correlation])).rows;
   if(candidates.length===0){await c.query('COMMIT');return 'unmatched';}
   if(candidates.length!==1)throw invalid();
   const {clerk_user_id:userId,idempotency_key:key}=candidates[0];
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[userId]);
   const row=(await c.query(`SELECT payload FROM resolute.notification_outbox WHERE clerk_user_id=$1 AND idempotency_key=$2 FOR UPDATE`,[userId,key])).rows[0];
   const p=row?.payload,a=p?.resendAttempt,r=p?.reservation;
   if(!a||hash(key)!==event.correlation||a.correlation!==event.correlation||a.recipientHash!==event.recipientHash||a.fromHash!==event.fromHash||r?.provider!=='resend'||r.status!=='attempting'||!Number.isFinite(Date.parse(r.attemptedAt))||
    Math.floor(Date.parse(event.acceptedAt)/1000)<Math.floor(Date.parse(r.attemptedAt)/1000)||
    (p.resend&&(p.resend.id!==event.id||p.resend.recipientHash!==event.recipientHash)))throw invalid();
   const facts=p.resendFeedback?.facts??{},old=facts[event.status];
   if(old&&old.occurredAt>=event.occurredAt){await c.query('COMMIT');return 'duplicate';}
   // Fixed set of at most seven status facts: later sent/delivered cannot erase
   // a bounce/complaint, and webhook retries cannot grow an unbounded event list.
   const feedback={facts:{...facts,[event.status]:{eventId:event.eventId,occurredAt:event.occurredAt}}};
   await c.query(`UPDATE resolute.notification_outbox SET payload=jsonb_set(jsonb_set(payload,'{resend}',$3::jsonb),'{resendFeedback}',$4::jsonb)
    WHERE clerk_user_id=$1 AND idempotency_key=$2`,[userId,key,JSON.stringify({id:event.id,recipientHash:event.recipientHash}),JSON.stringify(feedback)]);
   await c.query('COMMIT');return 'recorded';
  }catch(e){try{await c.query('ROLLBACK');}catch{}throw e;}finally{c.release();}
 };
}
export function createMailFeedbackRoute(options:{enabled:()=>boolean;secret:string;from:string;consume:(event:MailFeedback)=>Promise<unknown>;now?:()=>Date}) {
 let active=0;const now=options.now??(()=>new Date());
 const reply=(status:number)=>Response.json({received:status===200},{status,headers:{'Cache-Control':'private, no-store'}});
 return async(request:Request):Promise<Response|null>=>{
  const url=new URL(request.url);if(url.pathname!=='/webhooks/resend')return null;
  if(!options.enabled())return reply(503);
  if(request.method!=='POST'||url.search)return reply(405);
  if(active>=8)return reply(429);
  active++;
  try{
   if(request.headers.get('content-type')?.split(';',1)[0].trim()!=='application/json')return reply(415);
   const reader=request.body?.getReader();if(!reader)return reply(400);
   const parts:Uint8Array[]=[];let size=0;
   try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>65536)return reply(413);parts.push(p.value);}}
   finally{await reader.cancel();reader.releaseLock();}
   const verified=verifyMailFeedback(Buffer.concat(parts),request.headers,options.secret,now());
   const event=parseMailFeedback(verified.eventId,verified.body,options.from,now());
   if(event)await options.consume(event);
   return reply(200);
  }catch(e){return reply(e instanceof InvalidMailFeedback?400:503);}finally{active--;}
 };
}
