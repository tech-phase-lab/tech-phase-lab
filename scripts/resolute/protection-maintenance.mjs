/** Explicit bounded acceptance only; never opens ordinary customer publishing. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {S3Client,ListObjectsV2Command,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {createWriter,writerConfig,createBucketObjects} from '../../services/resolute-protection/server.mjs';
import {decryptProtection,protectionObjectKey,parseProtectionEvent,PROTECTION_PREFIX} from '../../lib/resolute/protection-ledger.ts';
const manifestPrefix='resolute/protection/manifests-v1/';
const digest=body=>createHash('sha256').update(body).digest('hex');
const namePattern=new RegExp('^'+PROTECTION_PREFIX+'[a-f0-9]{64}\\.bin$');
const send=(client,command)=>client.send(command,{abortSignal:AbortSignal.timeout(5000)});
export async function inventory(client,bucket){
 const items=new Map(),tokens=new Set();let token;
 for(let pages=0;pages<=100000;pages++){
  const page=await send(client,new ListObjectsV2Command({Bucket:bucket,Prefix:PROTECTION_PREFIX,...(token?{ContinuationToken:token}:{})}));
  if(typeof page.IsTruncated!=='boolean'||(page.Contents!==undefined&&!Array.isArray(page.Contents)))throw Error('INCOMPLETE_INVENTORY');
  for(const item of page.Contents??[]){
   if(!namePattern.test(item.Key)||items.has(item.Key)||!Number.isSafeInteger(item.Size)||item.Size<33||item.Size>2048||typeof item.ETag!=='string')throw Error('INVALID_INVENTORY');
   items.set(item.Key,{size:item.Size,etag:item.ETag});if(items.size>100000)throw Error('INVENTORY_LIMIT');
  }
  if(!page.IsTruncated)return [...items].sort(([a],[b])=>a.localeCompare(b));
  token=page.NextContinuationToken;
  if(typeof token!=='string'||!token||tokens.has(token))throw Error('INCOMPLETE_INVENTORY');
  tokens.add(token);
 }
 throw Error('INVENTORY_LIMIT');
}
async function read(client,bucket,name,limit){
 const response=await send(client,new GetObjectCommand({Bucket:bucket,Key:name}));const body=response.Body;
 try{
  if(!body||!Number.isSafeInteger(response.ContentLength)||response.ContentLength>limit||response.ContentLength<1)throw Error('INVALID_LENGTH');
  let size=0;const chunks=[];
  for await(const chunk of body){size+=chunk.length;if(size>limit)throw Error('READ_LIMIT');chunks.push(chunk);}
  if(size!==response.ContentLength)throw Error('TRUNCATED_READ');return Buffer.concat(chunks);
 }finally{body?.destroy?.();}
}
export async function seal(client,bucket,key,{expectedNames}={}){
 const before=await inventory(client,bucket);
 if(expectedNames)assert.deepEqual(before.map(([name])=>name),[...expectedNames].sort());
 const objects=[];
 for(const [name,meta] of before){
  const body=await read(client,bucket,name,2048);assert.equal(body.length,meta.size);
  decryptProtection(body,key,name);objects.push({key:name,sha256:digest(body)});
 }
 assert.deepEqual(await inventory(client,bucket),before);
 // Same canonical key order as Python json.dumps(sort_keys=True,separators=(',',':')).
 const body=Buffer.from(JSON.stringify({objects,version:1})),pin=digest(body),name=manifestPrefix+pin+'.json';
 await send(client,new PutObjectCommand({Bucket:bucket,Key:name,Body:body,ContentType:'application/json'}));
 assert.deepEqual(await read(client,bucket,name,body.length),body);
 assert.deepEqual(await inventory(client,bucket),before);
 return {pin,objects};
}
export function acceptanceEvents(userId,at){
 if(!/^user_acceptance[a-f0-9]{32}$/.test(userId))throw Error('SYNTHETIC_ID_REQUIRED');
 return ['delete','alerts_off','morning_off'].map((kind,index)=>parseProtectionEvent({version:1,userId,revision:index+1,kind,at}));
}
export function restrictedObjects(objects,key,events,finish){
 const expected=new Map(events.map(e=>[protectionObjectKey(e,key),JSON.stringify(e)]));
 if(expected.size!==3)throw Error('THREE_EVENTS_REQUIRED');
 let closed=false,queue=Promise.resolve();const written=new Set();
 return {
  async read(name){if(!expected.has(name))throw Error('OUT_OF_SCOPE');return objects.read(name);},
  async putIfAbsent(name,body){
   // Queue writes, and close the gate before sealing; no new put can race a list.
   const operation=queue.then(async()=>{
    if(closed||!expected.has(name)||JSON.stringify(decryptProtection(body,key,name))!==expected.get(name))throw Error('OUT_OF_SCOPE');
    await objects.putIfAbsent(name,body);written.add(name);
    if(written.size===3){closed=true;await finish([...expected.keys()]);}
   });queue=operation.catch(()=>{});return operation;
  },
  close(){closed=true;},
 };
}
export async function main(env=process.env){
 if(env.RESOLUTE_MAINTENANCE_ACCEPTANCE!=='true')return;
 assert.equal(env.RAILWAY_PROJECT_ID,'0872be15-db75-4e5a-ae0f-881911fb442d');
 assert.equal(env.RAILWAY_ENVIRONMENT_ID,'3a80776d-15a3-4ca1-bd0c-e0c915ccf73b');
 assert.equal(env.RAILWAY_SERVICE_ID,'9d9728c1-aeae-4b33-9654-fe869f42e928');
 assert.equal(env.RESOLUTE_WRITER_ENABLED,'false');
 const events=acceptanceEvents(env.RESOLUTE_MAINTENANCE_USER,env.RESOLUTE_MAINTENANCE_AT);
 const deadline=Date.parse(env.RESOLUTE_MAINTENANCE_DEADLINE),remaining=deadline-Date.now();
 if(!Number.isFinite(remaining)||remaining<1000||remaining>900000)throw Error('INVALID_DEADLINE');
 const config=writerConfig(env),client=new S3Client({endpoint:config.endpoint,region:config.region,credentials:config.credentials,maxAttempts:1});
 let server,timer;
 try{
  // First production acceptance requires genuinely empty current history. Never
  // silently adopt an old pin, unknown customer records or a partially run probe.
  const baseline=await seal(client,config.bucket,config.key,{expectedNames:[]});
  console.log(JSON.stringify({event:'RESOLUTE_FRESH_BASELINE_SEALED',...baseline,at:new Date().toISOString()}));
  const objects=restrictedObjects(createBucketObjects(client,config.bucket),config.key,events,async names=>{
   const final=await seal(client,config.bucket,config.key,{expectedNames:names});
   console.log(JSON.stringify({event:'RESOLUTE_NONEMPTY_MANIFEST_SEALED',...final,at:new Date().toISOString()}));
  });
  server=createWriter({...config,objects,maxConcurrent:2});
  const stop=()=>{objects.close();server.closeAllConnections();server.close();client.destroy();};
  timer=setTimeout(stop,Math.max(1,deadline-Date.now()));
  if(Date.now()>=deadline)throw Error('DEADLINE_EXPIRED');
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(env.PORT??3000),'::',resolve);});
  server.once('close',()=>{clearTimeout(timer);client.destroy();});
  console.log(JSON.stringify({event:'RESOLUTE_BOUNDED_ACCEPTANCE_READY',syntheticUser:events[0].userId,deadline:new Date(deadline).toISOString(),customerSaving:false}));
  return server;
 }catch(error){clearTimeout(timer);server?.closeAllConnections();server?.close();client.destroy();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().catch(()=>{console.error('{"event":"RESOLUTE_MAINTENANCE_FAILED"}');process.exitCode=1;});
}
