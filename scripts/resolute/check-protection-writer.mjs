/** Synthetic deployed-gateway acceptance. No DB, payments, email or customer data. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {protectionGatewayConfig,protectionGatewayObjects} from '../../lib/resolute/protection-runtime.ts';
import {createProtectionPublisher,protectionObjectKey,encryptProtection,decryptProtection} from '../../lib/resolute/protection-ledger.ts';
export async function checkWriter(env=process.env){
 if(env.RESOLUTE_WRITER_ACCEPTANCE_ONLY!=='true')return {event:'RESOLUTE_WRITER_ACCEPTANCE_DISABLED'};
 const {endpoint,token,key}=protectionGatewayConfig(env);
 const userId='user_acceptance'+randomBytes(16).toString('hex');
 const objects=protectionGatewayObjects(endpoint,token),publish=createProtectionPublisher(objects,key);
 const records=[];
 for(const [index,kind] of ['delete','alerts_off','morning_off'].entries()){
  const event={version:1,userId,revision:index+1,kind,at:new Date().toISOString()};
  const receipt=await publish(event),name=protectionObjectKey(event,key);
  assert.equal(await publish(event),receipt);
  await assert.rejects(publish({...event,at:new Date(Date.parse(event.at)+1).toISOString()}));
  const body=await objects.read(name);assert.deepEqual(decryptProtection(body,key,name),event);
  records.push({name,sha256:receipt});
 }
 const path=endpoint+'/v1/events/'+records[0].name.split('/').at(-1);
 const headers={authorization:`Bearer ${token}`};
 for(const [url,method,requestHeaders,status] of [[path,'DELETE',headers,405],[endpoint+'/v1/events','GET',headers,404],[path,'GET',{},401],[path+'?delete','GET',headers,404]]){
  const response=await fetch(url,{method,headers:requestHeaders,redirect:'error',signal:AbortSignal.timeout(5000)});
  assert.equal(response.status,status);await response.body?.cancel();
 }
 const response=await fetch(path,{method:'PUT',headers:{...headers,'content-type':'application/octet-stream'},body:new Uint8Array(encryptProtection({version:1,userId,revision:1,kind:'delete',at:new Date().toISOString()},key)),redirect:'error',signal:AbortSignal.timeout(5000)});
 assert.equal(response.status,400);await response.body?.cancel();
 for(const record of records)assert.equal((await objects.read(record.name)).length>32,true);
 return {event:'RESOLUTE_WRITER_ACCEPTANCE_OK',synthetic:true,objects:3,checks:['publish','authenticated_readback','idempotent_retry','conflict_rejected','delete_rejected','list_rejected','unauthorized_rejected','query_rejected','unconditional_put_rejected'],records};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 checkWriter().then(result=>console.log(JSON.stringify(result)))
 .catch(()=>{console.error('{"event":"RESOLUTE_WRITER_ACCEPTANCE_FAILED"}');process.exitCode=1;});
}
