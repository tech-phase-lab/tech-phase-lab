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
// --- Chained manifests (docs/RESOLUTE-PROTECTION-CHAIN.md) --------------------
// Same format and rules as protection_events.py load_chain/chain_manifest.
export const chainPrefix='resolute/protection/manifests-v2/';
const shaPattern=/^[a-f0-9]{64}$/,timePattern=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const chainNamePattern=new RegExp('^'+chainPrefix+'[a-f0-9]{64}\\.json$');
const manifestLimit=32*1024*1024,chainLimit=5000;
async function listChain(client,bucket){
 const names=[],tokens=new Set();let token;
 for(let pages=0;pages<=chainLimit;pages++){
  const page=await send(client,new ListObjectsV2Command({Bucket:bucket,Prefix:chainPrefix,...(token?{ContinuationToken:token}:{})}));
  if(typeof page.IsTruncated!=='boolean'||(page.Contents!==undefined&&!Array.isArray(page.Contents)))throw Error('INCOMPLETE_INVENTORY');
  for(const item of page.Contents??[]){
   if(!chainNamePattern.test(item.Key)||names.includes(item.Key)||!Number.isSafeInteger(item.Size)||item.Size<2||item.Size>manifestLimit)throw Error('INVALID_CHAIN');
   names.push(item.Key);if(names.length>chainLimit)throw Error('INVALID_CHAIN');
  }
  if(!page.IsTruncated)return names.sort();
  token=page.NextContinuationToken;
  if(typeof token!=='string'||!token||tokens.has(token))throw Error('INCOMPLETE_INVENTORY');
  tokens.add(token);
 }
 throw Error('INVALID_CHAIN');
}
function parseObjects(objects,ordered){
 if(!Array.isArray(objects)||objects.length>100000)throw Error('INVALID_CHAIN');
 const result=new Map();let last='';
 for(const item of objects){
  if(!item||typeof item!=='object'||Object.keys(item).sort().join()!=='key,sha256'||typeof item.key!=='string'||!namePattern.test(item.key)
   ||typeof item.sha256!=='string'||!shaPattern.test(item.sha256)||result.has(item.key)||(ordered&&item.key<=last))throw Error('INVALID_CHAIN');
  last=item.key;result.set(item.key,item.sha256);
 }
 return result;
}
export function chainManifest(anchor,previous,height,objects,mode,sealedAt){
 // Alphabetical keys: identical bytes to Python json.dumps(sort_keys=True,separators=(',',':')).
 const body=Buffer.from(JSON.stringify({anchor,height,mode,objects:objects.map(({key,sha256})=>({key,sha256})),previous,sealedAt,version:2}));
 return {pin:digest(body),body};
}
function chainObjects(raw,anchor){
 const value=JSON.parse(raw.toString('utf8'));
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!=='anchor,height,mode,objects,previous,sealedAt,version'
  ||value.version!==2||typeof value.anchor!=='string'||!shaPattern.test(value.anchor)||typeof value.previous!=='string'||!shaPattern.test(value.previous)
  ||!Number.isSafeInteger(value.height)||value.height<1||value.height>chainLimit||!['restore','maintenance'].includes(value.mode)
  ||typeof value.sealedAt!=='string'||!timePattern.test(value.sealedAt)||!Number.isFinite(Date.parse(value.sealedAt)))throw Error('INVALID_CHAIN');
 const objects=parseObjects(value.objects,true);
 if(!chainManifest(value.anchor,value.previous,value.height,value.objects,value.mode,value.sealedAt).body.equals(raw))throw Error('INVALID_CHAIN');
 if(value.anchor!==anchor)return null;
 if((value.height===1)!==(value.previous===anchor))throw Error('INVALID_CHAIN');
 return {value,objects};
}
export async function loadChain(client,bucket,anchor){
 if(typeof anchor!=='string'||!shaPattern.test(anchor))throw Error('ANCHOR_REQUIRED');
 const anchorRaw=await read(client,bucket,manifestPrefix+anchor+'.json',manifestLimit);
 if(digest(anchorRaw)!==anchor)throw Error('ANCHOR_INVALID');
 const parsed=JSON.parse(anchorRaw.toString('utf8'));
 if(!parsed||typeof parsed!=='object'||Object.keys(parsed).sort().join()!=='objects,version'||parsed.version!==1)throw Error('ANCHOR_INVALID');
 const anchorObjects=parseObjects(parsed.objects,false),found=[];
 for(const name of await listChain(client,bucket)){
  const raw=await read(client,bucket,name,manifestLimit),pin=name.slice(chainPrefix.length,-5);
  if(digest(raw)!==pin)throw Error('INVALID_CHAIN');
  const manifest=chainObjects(raw,anchor);if(manifest)found.push({pin,...manifest});
 }
 found.sort((a,b)=>a.value.height-b.value.height||(a.pin<b.pin?-1:1));
 const linked=new Map([[anchor,{height:0,objects:anchorObjects}]]);
 for(const {pin,value,objects} of found){
  const parent=linked.get(value.previous);
  if(!parent||parent.height+1!==value.height)throw Error('INVALID_CHAIN');
  for(const [name,sha] of parent.objects)if(objects.get(name)!==sha)throw Error('INVALID_CHAIN');
  linked.set(pin,{height:value.height,objects});
 }
 const expected=new Map();
 for(const {objects} of linked.values())for(const [name,sha] of objects){
  if(expected.has(name)&&expected.get(name)!==sha)throw Error('INVALID_CHAIN');expected.set(name,sha);
 }
 let tip=anchor;
 for(const [pin,{height}] of linked){const best=linked.get(tip).height;if(height>best||(height===best&&pin<tip))tip=pin;}
 return {anchorObjects,expected,tip,height:linked.get(tip).height,tipObjects:linked.get(tip).objects,linked:linked.size-1};
}
/** Step-1 maintenance: with ALL writers fenced, seal the current nonempty
 * inventory as a new chained manifest. Never overwrites; never shrinks history. */
export async function reseal(client,bucket,key,anchor,{sealedAt=new Date().toISOString()}={}){
 const chain=await loadChain(client,bucket,anchor),before=await inventory(client,bucket),present=new Map(before);
 for(const name of chain.expected.keys())if(!present.has(name))throw Error('MISSING_OBJECT');
 const objects=[];
 for(const [name,meta] of before){
  const body=await read(client,bucket,name,2048);assert.equal(body.length,meta.size);
  const sha256=digest(body);
  if(chain.expected.has(name)&&chain.expected.get(name)!==sha256)throw Error('MODIFIED_OBJECT');
  decryptProtection(body,key,name);objects.push({key:name,sha256});
 }
 // Fenced: the listing must be exactly stable, not merely a superset.
 assert.deepEqual(await inventory(client,bucket),before);
 const added=objects.filter(o=>!chain.tipObjects.has(o.key)).length;
 if(added===0&&objects.length===chain.tipObjects.size)return {pin:null,previous:chain.tip,height:chain.height,objects:objects.length,added:0};
 const {pin,body}=chainManifest(anchor,chain.tip,chain.height+1,objects,'maintenance',sealedAt),name=chainPrefix+pin+'.json';
 try{await send(client,new PutObjectCommand({Bucket:bucket,Key:name,Body:body,IfNoneMatch:'*',ContentType:'application/json'}));}
 catch(error){if(error?.$metadata?.httpStatusCode!==412)throw error;}
 assert.deepEqual(await read(client,bucket,name,body.length),body);
 assert.deepEqual(await inventory(client,bucket),before);
 return {pin,previous:chain.tip,height:chain.height+1,objects:objects.length,added};
}
function assertWriterService(env){
 assert.equal(env.RAILWAY_PROJECT_ID,'0872be15-db75-4e5a-ae0f-881911fb442d');
 assert.equal(env.RAILWAY_ENVIRONMENT_ID,'3a80776d-15a3-4ca1-bd0c-e0c915ccf73b');
 assert.equal(env.RAILWAY_SERVICE_ID,'9d9728c1-aeae-4b33-9654-fe869f42e928');
 assert.equal(env.RESOLUTE_WRITER_ENABLED,'false');
}
export async function resealMain(env=process.env){
 if(env.RESOLUTE_MAINTENANCE_RESEAL!=='true')return;
 if(env.RESOLUTE_MAINTENANCE_ACCEPTANCE==='true')throw Error('ONE_MAINTENANCE_MODE');
 assertWriterService(env);
 // The operator attests the external fence (API saving/retry off, writer off).
 assert.equal(env.RESOLUTE_MAINTENANCE_WRITERS_FENCED,'true');
 const anchor=env.RESOLUTE_MAINTENANCE_ANCHOR_SHA256;
 if(typeof anchor!=='string'||!shaPattern.test(anchor))throw Error('ANCHOR_REQUIRED');
 const config=writerConfig(env),client=new S3Client({endpoint:config.endpoint,region:config.region,credentials:config.credentials,maxAttempts:1});
 try{
  const result=await reseal(client,config.bucket,config.key,anchor);
  console.log(JSON.stringify({event:'RESOLUTE_CHAIN_RESEALED',anchor,manifest:result.pin,previous:result.previous,height:result.height,objects:result.objects,added:result.added,unchanged:result.pin===null,at:new Date().toISOString()}));
  return result;
 }finally{client.destroy();}
}
export async function main(env=process.env){
 if(env.RESOLUTE_MAINTENANCE_RESEAL==='true')return resealMain(env);
 if(env.RESOLUTE_MAINTENANCE_ACCEPTANCE!=='true')return;
 assertWriterService(env);
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
