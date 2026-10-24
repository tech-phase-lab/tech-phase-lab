import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes} from 'node:crypto';
export type ProtectionEvent={version:1;userId:string;revision:number;kind:'delete'|'alerts_off'|'morning_off';at:string};
export const PROTECTION_PREFIX='resolute/protection/events-v1/';
export class ProtectionUnavailable extends Error {constructor(){super('PROTECTION_UNAVAILABLE');}}
export function parseProtectionEvent(value:unknown):ProtectionEvent {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ProtectionUnavailable();
 const v=value as Record<string,unknown>;
 if(Object.keys(v).sort().join(',')!=='at,kind,revision,userId,version'||v.version!==1||
  typeof v.userId!=='string'||!/^user_[A-Za-z0-9]{1,128}$/.test(v.userId)||
  !Number.isSafeInteger(v.revision)||(v.revision as number)<=0||(v.revision as number)>=Number.MAX_SAFE_INTEGER||
  !['delete','alerts_off','morning_off'].includes(v.kind as string)||typeof v.at!=='string'||
  !Number.isFinite(Date.parse(v.at))||new Date(v.at).toISOString()!==v.at)throw new ProtectionUnavailable();
 return {version:1,userId:v.userId,revision:v.revision as number,kind:v.kind as ProtectionEvent['kind'],at:v.at};
}
function validKey(key:Buffer){if(key.length!==32)throw new ProtectionUnavailable();}
export function protectionObjectKey(event:ProtectionEvent,key:Buffer){
 validKey(key);const e=parseProtectionEvent(event);
 return PROTECTION_PREFIX+createHmac('sha256',key).update(`resolute-event-v1\n${e.userId}\n${e.kind}\n${e.revision}`).digest('hex')+'.bin';
}
export function encryptProtection(event:ProtectionEvent,key:Buffer):Buffer {
 validKey(key);const e=parseProtectionEvent(event),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
 cipher.setAAD(Buffer.from(protectionObjectKey(e,key)));
 const body=Buffer.concat([cipher.update(JSON.stringify(e),'utf8'),cipher.final()]);
 return Buffer.concat([Buffer.from('RPE1'),nonce,cipher.getAuthTag(),body]);
}
export function decryptProtection(body:Uint8Array,key:Buffer,objectKey:string):ProtectionEvent {
 try{
  validKey(key);const b=Buffer.from(body);
  if(b.length<33||b.length>2048||b.subarray(0,4).toString()!=='RPE1')throw new ProtectionUnavailable();
  const decipher=createDecipheriv('aes-256-gcm',key,b.subarray(4,16));
  decipher.setAAD(Buffer.from(objectKey));decipher.setAuthTag(b.subarray(16,32));
  const event=parseProtectionEvent(JSON.parse(Buffer.concat([decipher.update(b.subarray(32)),decipher.final()]).toString('utf8')));
  if(protectionObjectKey(event,key)!==objectKey)throw new ProtectionUnavailable();return event;
 }catch{throw new ProtectionUnavailable();}
}
export type ProtectionObjects={putIfAbsent:(key:string,body:Buffer)=>Promise<void>;read:(key:string)=>Promise<Uint8Array>};
export function createProtectionPublisher(objects:ProtectionObjects,key:Buffer){
 validKey(key);
 return async(input:ProtectionEvent)=>{
  const event=parseProtectionEvent(input),objectKey=protectionObjectKey(event,key);
  // A lost PUT reply may have stored the immutable object. Reconcile through GET.
  try{await objects.putIfAbsent(objectKey,encryptProtection(event,key));}catch{}
  try{
   const stored=await objects.read(objectKey),readback=decryptProtection(stored,key,objectKey);
   if(JSON.stringify(readback)!==JSON.stringify(event))throw new ProtectionUnavailable();
   return createHash('sha256').update(stored).digest('hex');
  }catch{throw new ProtectionUnavailable();}
 };
}
