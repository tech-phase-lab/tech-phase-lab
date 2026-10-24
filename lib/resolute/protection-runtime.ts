import {createProtectionPublisher,ProtectionUnavailable,PROTECTION_PREFIX} from './protection-ledger.ts';
import {createProtectionBarrier} from './protection-outbox.ts';

export function protectionGatewayConfig(env:NodeJS.ProcessEnv){
 if(env.RESOLUTE_PROTECTION_ENABLED!=='true')throw new ProtectionUnavailable();
 // Direct bucket credentials must not coexist with the application boundary.
 if(['RESOLUTE_PROTECTION_ACCESS_KEY_ID','RESOLUTE_PROTECTION_SECRET_ACCESS_KEY','RESOLUTE_PROTECTION_ENDPOINT','RESOLUTE_PROTECTION_BUCKET','RESOLUTE_WRITER_ACCESS_KEY_ID','RESOLUTE_WRITER_SECRET_ACCESS_KEY'].some(name=>env[name]))throw new ProtectionUnavailable();
 const endpoint=new URL(env.RESOLUTE_PROTECTION_WRITER_URL??'');
 const token=env.RESOLUTE_PROTECTION_WRITER_TOKEN,hex=env.RESOLUTE_PROTECTION_KEY_HEX;
 if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.up.railway.app')||endpoint.port||endpoint.pathname!=='/'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!token||!/^[-_A-Za-z0-9]{48,128}$/.test(token)||!hex||!/^[a-f0-9]{64}$/.test(hex))throw new ProtectionUnavailable();
 return {endpoint:endpoint.origin,token,key:Buffer.from(hex,'hex')};
}
export function protectionGatewayObjects(endpoint:string,token:string,request:typeof fetch=fetch){
 async function send(name:string,body?:Buffer){
  if(!new RegExp('^'+PROTECTION_PREFIX+'[a-f0-9]{64}\\.bin$').test(name))throw new ProtectionUnavailable();
  const response=await request(endpoint+'/v1/events/'+name.slice(PROTECTION_PREFIX.length),{
   method:body?'PUT':'GET',redirect:'error',signal:AbortSignal.timeout(4000),
   headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/octet-stream','if-none-match':'*'}:{})},
   ...(body?{body:new Uint8Array(body)}:{})
  });
  if(response.status!==(body?201:200)){await response.body?.cancel();throw new ProtectionUnavailable();}
  if(body){await response.body?.cancel();return new Uint8Array();}
  const reader=response.body?.getReader();if(!reader)throw new ProtectionUnavailable();
  const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>2048)throw new ProtectionUnavailable();chunks.push(part.value);}}
  finally{await reader.cancel();}
  return Buffer.concat(chunks);
 }
 return {async putIfAbsent(name:string,body:Buffer){await send(name,body);},async read(name:string){return send(name);}};
}
export function protectionRuntime(env:NodeJS.ProcessEnv=process.env){
 const {endpoint,token,key}=protectionGatewayConfig(env);
 return createProtectionBarrier(createProtectionPublisher(protectionGatewayObjects(endpoint,token),key));
}
