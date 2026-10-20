import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {inventory,seal,acceptanceEvents,restrictedObjects,main} from '../scripts/resolute/protection-maintenance.mjs';
import {encryptProtection,protectionObjectKey,createProtectionPublisher} from '../lib/resolute/protection-ledger.ts';
const key=randomBytes(32),events=acceptanceEvents('user_acceptance'+'a'.repeat(32),'2026-10-20T14:30:00.000Z');
function fixture(){
 const data=new Map(),calls=[];
 const client={async send(command){
  const {Key,Body}=command.input,type=command.constructor.name;calls.push({type,key:Key});
  if(type==='ListObjectsV2Command')return {IsTruncated:false,Contents:[...data].filter(([k])=>k.includes('/events-v1/')).map(([Key,b])=>({Key,Size:b.length,ETag:createHash('sha256').update(b).digest('hex')}))};
  if(type==='PutObjectCommand'){data.set(Key,Buffer.from(Body));return {};}
  if(type==='GetObjectCommand'){const b=data.get(Key);if(!b)throw Error('missing');return {ContentLength:b.length,Body:Readable.from([b])};}
  throw Error('unexpected');
 }};return {client,data,calls};
}
test('maintenance rejects incomplete, duplicate-token and invalid inventory before sealing',async()=>{
 for(const page of [{},{IsTruncated:1},{IsTruncated:true},{IsTruncated:true,NextContinuationToken:''},{IsTruncated:false,Contents:{}}]){
  await assert.rejects(inventory({send:async()=>page},'bucket'));
 }
 let calls=0;await assert.rejects(inventory({send:async()=>{calls++;return {IsTruncated:true,NextContinuationToken:'same'};}},'bucket'));
 assert.equal(calls,2);
});
test('maintenance consumes every explicit page and rejects duplicate event keys',async()=>{
 const name=protectionObjectKey(events[0],key),item={Key:name,Size:100,ETag:'etag'};
 let n=0;const pages=[{IsTruncated:true,NextContinuationToken:'next',Contents:[item]},{IsTruncated:false,Contents:[]}];
 assert.equal((await inventory({send:async command=>{if(n===1)assert.equal(command.input.ContinuationToken,'next');return pages[n++];}},'b')).length,1);
 n=0;pages[1].Contents=[item];await assert.rejects(inventory({send:async()=>pages[n++]},'b'));
});
test('fresh baseline and nonempty seals match Python canonical manifests and decrypt in Python',async()=>{
 const f=fixture();const baseline=await seal(f.client,'b',key,{expectedNames:[]});assert.equal(baseline.objects.length,0);
 for(const e of events)f.data.set(protectionObjectKey(e,key),encryptProtection(e,key));
 const final=await seal(f.client,'b',key,{expectedNames:events.map(e=>protectionObjectKey(e,key))});assert.equal(final.objects.length,3);
 const payload={key:key.toString('hex'),pin:final.pin,records:[...f.data].map(([name,b])=>[name,b.toString('base64')])};
 const result=spawnSync('python3',['-c',`import sys,json,base64,hashlib,io
sys.path.insert(0,'scripts/resolute')
import protection_events as p, protection
v=json.load(sys.stdin); data={n:base64.b64decode(b) for n,b in v['records']}
class S:
 def get_paginator(self,*a):return self
 def paginate(self,**kw):yield {'IsTruncated':False,'Contents':[{'Key':n,'Size':len(b),'ETag':hashlib.sha256(b).hexdigest()} for n,b in data.items() if n.startswith(p.PREFIX)]}
 def get_object(self,**kw):return {'Body':io.BytesIO(data[kw['Key']])}
raw=data[p.MANIFEST_PREFIX+v['pin']+'.json']
assert raw==json.dumps(json.loads(raw),sort_keys=True,separators=(',',':')).encode()
r=p.load_manifest(S(),'b',bytes.fromhex(v['key']),v['pin'],protection,require_complete_inventory=True)
assert len(r['deletions'])==1 and len(r['suppressions'])==2
print('PYTHON_COMPLETE_MANIFEST_OK')`],{input:JSON.stringify(payload),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/PYTHON_COMPLETE_MANIFEST_OK/);
});
test('seal rejects changed listing and damaged objects without writing a manifest',async()=>{
 const f=fixture(),name=protectionObjectKey(events[0],key);f.data.set(name,encryptProtection(events[0],key));
 const send=f.client.send;let lists=0;f.client.send=async cmd=>{const r=await send(cmd);if(cmd.constructor.name==='ListObjectsV2Command'&&++lists===2)r.Contents=[];return r;};
 await assert.rejects(seal(f.client,'b',key));assert.equal(f.calls.filter(c=>c.type==='PutObjectCommand').length,0);
 const g=fixture();g.data.set(name,Buffer.alloc(50));await assert.rejects(seal(g.client,'b',key));assert.equal(g.calls.filter(c=>c.type==='PutObjectCommand').length,0);
});
test('restricted publishing permits exactly three matching events then seals once and closes',async()=>{
 const records=new Map();let finished=0,writes=0;
 const base={async putIfAbsent(n,b){writes++;if(records.has(n))throw Error('exists');records.set(n,b);},async read(n){if(!records.has(n))throw Error('missing');return records.get(n);}};
 const limited=restrictedObjects(base,key,events,async names=>{assert.equal(records.size,3);assert.equal(names.length,3);finished++;});
 const publish=createProtectionPublisher(limited,key);
 const other={...events[0],userId:'user_customer'};
 await assert.rejects(publish(other));await assert.rejects(publish({...events[0],at:'2026-10-20T14:31:00.000Z'}));assert.equal(writes,0);
 const receipts=await Promise.all(events.map(publish));assert.equal(finished,1);assert.equal(writes,3);
 assert.deepEqual(await Promise.all(events.map(publish)),receipts);assert.equal(writes,3);assert.equal(finished,1);
 await assert.rejects(publish({...events[0],revision:4}));assert.equal(writes,3);
});
test('failed sealing keeps gate closed, including when reads reconcile a stored receipt',async()=>{
 const data=new Map();let puts=0;
 const restricted=restrictedObjects({async putIfAbsent(n,b){puts++;data.set(n,b);},async read(n){if(!data.has(n))throw Error('missing');return data.get(n);}},key,events,async()=>{throw Error('seal failed');});
 const publish=createProtectionPublisher(restricted,key);
 for(const e of events)await publish(e);
 await publish(events[0]);assert.equal(puts,3);
 restricted.close();await assert.rejects(restricted.putIfAbsent(protectionObjectKey(events[0],key),encryptProtection(events[0],key)));
});
test('maintenance is inert by default and rejects wrong service before any network access',async()=>{
 assert.equal(await main({}),undefined);
 await assert.rejects(main({RESOLUTE_MAINTENANCE_ACCEPTANCE:'true',RAILWAY_PROJECT_ID:'wrong'}));
 assert.throws(()=>acceptanceEvents('user_customer','2026-10-20T14:30:00.000Z'));
});
