import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {seal,reseal,loadChain,chainManifest,chainPrefix,main,resealMain} from '../scripts/resolute/protection-maintenance.mjs';
import {encryptProtection,protectionObjectKey,parseProtectionEvent} from '../lib/resolute/protection-ledger.ts';
const key=randomBytes(32);
const synthetic=['delete','alerts_off','morning_off'].map((kind,i)=>parseProtectionEvent({version:1,userId:'user_acceptance'+'a'.repeat(32),revision:i+1,kind,at:'2026-10-20T14:48:39.059Z'}));
const member=[parseProtectionEvent({version:1,userId:'user_member1',revision:2,kind:'delete',at:'2026-11-13T06:33:00.000Z'}),
 parseProtectionEvent({version:1,userId:'user_member1',revision:2,kind:'alerts_off',at:'2026-11-13T06:33:01.000Z'})];
const sha=body=>createHash('sha256').update(body).digest('hex');
function store(){
 const data=new Map(),puts=[];
 const client={async send(command){
  const {Key,Body,Prefix}=command.input,type=command.constructor.name;
  if(type==='ListObjectsV2Command'){
   const items=[...data].filter(([k])=>k.startsWith(Prefix)).sort(([a],[b])=>a<b?-1:1).map(([K,b])=>({Key:K,Size:b.length,ETag:sha(b)}));
   // Two explicit pages, including the continuation token.
   if(!command.input.ContinuationToken)return {IsTruncated:true,NextContinuationToken:'p2',Contents:items.slice(0,1)};
   return {IsTruncated:false,Contents:items.slice(1)};
  }
  if(type==='PutObjectCommand'){puts.push(Key);if(data.has(Key)){const e=Error('exists');e.$metadata={httpStatusCode:412};throw e;}data.set(Key,Buffer.from(Body));return {};}
  if(type==='GetObjectCommand'){const b=data.get(Key);if(!b)throw Error('missing');return {ContentLength:b.length,Body:Readable.from([b])};}
  throw Error('unexpected');
 }};
 const add=e=>{const name=protectionObjectKey(e,key);data.set(name,encryptProtection(e,key));return name;};
 return {client,data,puts,add};
}
async function anchored(){
 const s=store();for(const e of synthetic)s.add(e);
 const {pin}=await seal(s.client,'b',key);s.puts.length=0;return {...s,anchor:pin};
}
function pythonVerify(s,anchor,dbEvents){
 const payload={key:key.toString('hex'),anchor,db:dbEvents,records:[...s.data].map(([n,b])=>[n,b.toString('base64')])};
 return spawnSync('python3',['-c',`import sys,json,base64,io,datetime
sys.path.insert(0,'scripts/resolute')
import protection_events as p, protection
v=json.load(sys.stdin); data={n:base64.b64decode(b) for n,b in v['records']}
class S:
 def get_paginator(self,*a):return self
 def paginate(self,**kw):yield {'IsTruncated':False,'Contents':[{'Key':n,'Size':len(b),'ETag':str(len(b))} for n,b in sorted(data.items()) if n.startswith(kw['Prefix'])]}
 def get_object(self,**kw):return {'Body':io.BytesIO(data[kw['Key']])}
try:
 r=p.verify_append_only(S(),'b',bytes.fromhex(v['key']),v['anchor'],protection,db_events=v['db'],backup_cutoff=datetime.datetime(2026,11,15,tzinfo=datetime.timezone.utc))
 print(json.dumps({'ok':True,'tip':r['tip'],'height':r['height'],'objects':len(r['objects'])}))
except p.InventoryError as e:
 print(json.dumps({'ok':False,'reason':e.reason}))`],{input:JSON.stringify(payload),encoding:'utf8'});
}
const rows=events=>events.map(({userId,revision,kind,at})=>({userId,revision,kind,at}));

test('reseal seals a nonempty inventory as a chained manifest that Python accepts',async()=>{
 const s=await anchored();for(const e of member)s.add(e);
 const first=await reseal(s.client,'b',key,s.anchor,{sealedAt:'2026-11-16T01:00:00.000Z'});
 assert.equal(first.height,1);assert.equal(first.previous,s.anchor);assert.equal(first.objects,5);assert.equal(first.added,2);
 const raw=s.data.get(chainPrefix+first.pin+'.json');assert.equal(sha(raw),first.pin);
 assert.deepEqual(s.puts,[chainPrefix+first.pin+'.json']);
 const out=spawnSync('python3',['-c',`import sys,json
sys.path.insert(0,'scripts/resolute')
import protection_events as p
raw=sys.stdin.buffer.read();assert p.canonical(json.loads(raw))==raw;print('CANONICAL')`],{input:raw});
 assert.equal(out.status,0,String(out.stderr));
 const verified=pythonVerify(s,s.anchor,rows(member));assert.equal(verified.status,0,verified.stderr);
 assert.deepEqual(JSON.parse(verified.stdout),{ok:true,tip:first.pin,height:1,objects:5});
 // Unchanged inventory: no new manifest, no write.
 s.puts.length=0;assert.equal((await reseal(s.client,'b',key,s.anchor)).pin,null);assert.deepEqual(s.puts,[]);
 // Python then rejects losing an object that only the chained manifest recorded.
 s.data.delete(protectionObjectKey(member[0],key));
 assert.deepEqual(JSON.parse(pythonVerify(s,s.anchor,rows([member[1]])).stdout),{ok:false,reason:'inventory-missing-object'});
});

test('Python-written restore manifest extends the chain that Node then resumes',async()=>{
 const s=await anchored();s.add(member[0]);
 const result=spawnSync('python3',['-c',`import sys,json,base64,io,datetime
sys.path.insert(0,'scripts/resolute')
import protection_events as p, protection
v=json.load(sys.stdin); data={n:base64.b64decode(b) for n,b in v['records']}
class S:
 def get_paginator(self,*a):return self
 def paginate(self,**kw):yield {'IsTruncated':False,'Contents':[{'Key':n,'Size':len(b),'ETag':str(len(b))} for n,b in sorted(data.items()) if n.startswith(kw['Prefix'])]}
 def get_object(self,**kw):return {'Body':io.BytesIO(data[kw['Key']])}
 def put_object(self,**kw):data[kw['Key']]=kw['Body']
s=S();r=p.verify_append_only(s,'b',bytes.fromhex(v['key']),v['anchor'],protection,db_events=v['db'],backup_cutoff=datetime.datetime(2026,11,15,tzinfo=datetime.timezone.utc))
d=p.extend_chain(s,'b',v['anchor'],r,mode='restore',sealed_at='2026-11-16T00:03:00.000Z')
print(json.dumps({'pin':d,'body':base64.b64encode(data[p.CHAIN_PREFIX+d+'.json']).decode()}))`],{input:JSON.stringify({key:key.toString('hex'),anchor:s.anchor,db:rows([member[0]]),records:[...s.data].map(([n,b])=>[n,b.toString('base64')])}),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 const {pin,body}=JSON.parse(result.stdout);s.data.set(chainPrefix+pin+'.json',Buffer.from(body,'base64'));
 const chain=await loadChain(s.client,'b',s.anchor);assert.equal(chain.tip,pin);assert.equal(chain.height,1);assert.equal(chain.expected.size,4);
 s.add(member[1]);
 const next=await reseal(s.client,'b',key,s.anchor,{sealedAt:'2026-11-16T02:00:00.000Z'});
 assert.equal(next.previous,pin);assert.equal(next.height,2);assert.equal(next.added,1);
});

test('reseal refuses missing, modified, unauthenticated or changing objects and tampered chains',async()=>{
 const missing=await anchored();missing.data.delete(protectionObjectKey(synthetic[0],key));
 await assert.rejects(reseal(missing.client,'b',key,missing.anchor),/MISSING_OBJECT/);
 const modified=await anchored();const name=protectionObjectKey(synthetic[1],key);modified.data.set(name,encryptProtection(synthetic[1],key));
 await assert.rejects(reseal(modified.client,'b',key,modified.anchor),/MODIFIED_OBJECT/);
 const unknown=await anchored();unknown.data.set('resolute/protection/events-v1/'+'f'.repeat(64)+'.bin',encryptProtection(member[0],key));
 await assert.rejects(reseal(unknown.client,'b',key,unknown.anchor));
 const changing=await anchored();const send=changing.client.send;let lists=0;
 changing.client.send=async cmd=>{const r=await send(cmd);if(cmd.constructor.name==='ListObjectsV2Command'&&cmd.input.Prefix.includes('events-v1')&&!cmd.input.ContinuationToken&&++lists===2)changing.add(member[1]);return r;};
 await assert.rejects(reseal(changing.client,'b',key,changing.anchor));
 for(const s of [missing,modified,unknown,changing])assert.deepEqual(s.puts,[]);
 const tampered=await anchored();tampered.add(member[0]);
 const first=await reseal(tampered.client,'b',key,tampered.anchor,{sealedAt:'2026-11-16T01:00:00.000Z'});
 const raw=tampered.data.get(chainPrefix+first.pin+'.json'),value=JSON.parse(raw);
 const forge=(v)=>{const {pin,body}=chainManifest(v.anchor,v.previous,v.height,v.objects,v.mode,v.sealedAt);tampered.data.set(chainPrefix+pin+'.json',body);return pin;};
 const cases=[{...value,previous:first.pin,height:2,objects:value.objects.slice(1)},{...value,previous:'e'.repeat(64),height:2},{...value,previous:first.pin,height:3}];
 for(const v of cases){const pin=forge(v);await assert.rejects(loadChain(tampered.client,'b',tampered.anchor),/INVALID_CHAIN/);tampered.data.delete(chainPrefix+pin+'.json');}
 tampered.data.set(chainPrefix+first.pin+'.json',Buffer.concat([raw,Buffer.from(' ')]));
 await assert.rejects(loadChain(tampered.client,'b',tampered.anchor),/INVALID_CHAIN/);
 await assert.rejects(loadChain(tampered.client,'b','latest'),/ANCHOR_REQUIRED/);
});

test('reseal mode is inert by default and requires the writer service, fence attestation and one mode',async()=>{
 assert.equal(await resealMain({}),undefined);
 const env={RESOLUTE_MAINTENANCE_RESEAL:'true',RAILWAY_PROJECT_ID:'0872be15-db75-4e5a-ae0f-881911fb442d',
  RAILWAY_ENVIRONMENT_ID:'3a80776d-15a3-4ca1-bd0c-e0c915ccf73b',RAILWAY_SERVICE_ID:'9d9728c1-aeae-4b33-9654-fe869f42e928',
  RESOLUTE_WRITER_ENABLED:'false',RESOLUTE_MAINTENANCE_WRITERS_FENCED:'true',RESOLUTE_MAINTENANCE_ANCHOR_SHA256:'a'.repeat(64)};
 await assert.rejects(main({...env,RESOLUTE_MAINTENANCE_ACCEPTANCE:'true'}),/ONE_MAINTENANCE_MODE/);
 await assert.rejects(main({...env,RAILWAY_SERVICE_ID:'other'}));
 await assert.rejects(main({...env,RESOLUTE_WRITER_ENABLED:'true'}));
 await assert.rejects(main({...env,RESOLUTE_MAINTENANCE_WRITERS_FENCED:undefined}));
 await assert.rejects(main({...env,RESOLUTE_MAINTENANCE_ANCHOR_SHA256:'latest'}),/ANCHOR_REQUIRED/);
 // Complete gates still need valid writer configuration before any network access.
 await assert.rejects(main(env));
});
