import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {readFileSync} from 'node:fs';
import {createWriter,main,writerConfig,createBucketObjects} from '../services/resolute-protection/server.mjs';
import {protectionGatewayConfig,protectionGatewayObjects} from '../lib/resolute/protection-runtime.ts';
import {createProtectionPublisher,encryptProtection,protectionObjectKey} from '../lib/resolute/protection-ledger.ts';
const key=randomBytes(32),token='t'.repeat(64);
const event={version:1,userId:'user_test',revision:1,kind:'delete',at:'2026-10-19T12:00:00.000Z'};
async function fixture(t){
 const records=new Map();const calls=[];
 const server=createWriter({key,token,objects:{
  async putIfAbsent(name,body){calls.push('put');if(records.has(name))throw Error('exists');records.set(name,body);},
  async read(name){calls.push('get');if(!records.has(name))throw Error('missing');return records.get(name);}
 }});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const endpoint=`http://127.0.0.1:${server.address().port}`,name=protectionObjectKey(event,key);
 const path='/v1/events/'+name.split('/').at(-1);
 const headers={authorization:`Bearer ${token}`,'content-type':'application/octet-stream','if-none-match':'*'};
 return {records,calls,endpoint,name,path,headers};
}
test('isolated writer: actual HTTP publish, idempotent retry, conflict preserves original',async t=>{
 const f=await fixture(t);const publish=createProtectionPublisher(protectionGatewayObjects(f.endpoint,token),key);
 const receipt=await publish(event);assert.match(receipt,/^[a-f0-9]{64}$/);
 assert.equal(await publish(event),receipt);
 const before=Buffer.from(f.records.get(f.name));
 await assert.rejects(publish({...event,at:'2026-10-19T12:01:00.000Z'}));
 assert.deepEqual(f.records.get(f.name),before);assert.equal(f.records.size,1);
});
test('writer blocks unauthorized methods, paths and credentials before storage',async t=>{
 const f=await fixture(t);
 for(const [path,method,authorization] of [[f.path,'DELETE',`Bearer ${token}`],[f.path,'POST',`Bearer ${token}`],['/v1/events','GET',`Bearer ${token}`],[f.path+'?delete','GET',`Bearer ${token}`],['/v1/events/%2e%2e','GET',`Bearer ${token}`],[f.path,'GET','Bearer wrong'],[f.path,'GET','']]){
  const response=await fetch(f.endpoint+path,{method,headers:{authorization}});
  assert.ok([401,404,405].includes(response.status));await response.arrayBuffer();
 }
 const duplicate=await new Promise((resolve,reject)=>{
  const req=httpRequest(f.endpoint+f.path,{headers:['Host',new URL(f.endpoint).host,'Authorization',`Bearer ${token}`,'Authorization',`Bearer ${token}`]},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
  req.on('error',reject);req.end();
 });
 assert.equal(duplicate,401);assert.deepEqual(f.calls,[]);
});
test('writer rejects invalid ciphertext, wrong object binding, oversize and missing conditional header',async t=>{
 const f=await fixture(t);
 for(const [body,headers] of [[Buffer.from('not ciphertext'),f.headers],[encryptProtection({...event,revision:2},key),f.headers],[Buffer.alloc(2049),f.headers],[encryptProtection(event,key),{authorization:f.headers.authorization,'content-type':'application/octet-stream'}]]){
  const response=await fetch(f.endpoint+f.path,{method:'PUT',headers,body});
  assert.ok([400,413,503].includes(response.status));await response.arrayBuffer();
 }
 assert.deepEqual(f.calls,[]);
});
test('writer does not return damaged stored records',async t=>{
 const f=await fixture(t);f.records.set(f.name,Buffer.from('corrupted'));
 const response=await fetch(f.endpoint+f.path,{headers:f.headers});assert.equal(response.status,503);assert.equal(await response.text(),'');
});
test('client rejects redirects, oversized streams and non-event object names',async()=>{
 const calls=[];
 const objects=protectionGatewayObjects('https://writer.up.railway.app',token,async(url,init)=>{calls.push(init);return new Response(new Uint8Array(2049));});
 await assert.rejects(objects.read(protectionObjectKey(event,key)));assert.equal(calls[0].redirect,'error');
 await assert.rejects(objects.read('resolute/backups/anything'));assert.equal(calls.length,1);
 const redirects=protectionGatewayObjects('https://writer.up.railway.app',token,async()=>new Response(null,{status:302}));
 await assert.rejects(redirects.read(protectionObjectKey(event,key)));
});
test('runtime refuses direct bucket credentials and unsafe gateway configuration',()=>{
 const env={RESOLUTE_PROTECTION_ENABLED:'true',RESOLUTE_PROTECTION_WRITER_URL:'https://writer.up.railway.app',RESOLUTE_PROTECTION_WRITER_TOKEN:token,RESOLUTE_PROTECTION_KEY_HEX:key.toString('hex')};
 assert.equal(protectionGatewayConfig(env).endpoint,env.RESOLUTE_PROTECTION_WRITER_URL);
 for(const patch of [{RESOLUTE_PROTECTION_ENABLED:'false'},{RESOLUTE_PROTECTION_ACCESS_KEY_ID:'old'},{RESOLUTE_WRITER_SECRET_ACCESS_KEY:'secret'},{RESOLUTE_PROTECTION_WRITER_TOKEN:'short'},...['http://writer.up.railway.app','https://evil.example','https://writer.up.railway.app/path','https://user@writer.up.railway.app','https://writer.up.railway.app?query'].map(url=>({RESOLUTE_PROTECTION_WRITER_URL:url}))])assert.throws(()=>protectionGatewayConfig({...env,...patch}));
});
test('writer remains disabled without explicit gate and requires separate configuration',async()=>{
 assert.equal(await main({}),null);assert.throws(()=>writerConfig({}));
 assert.throws(()=>createWriter({key,token:'short',objects:{}}));
 const runtime=readFileSync(new URL('../lib/resolute/protection-runtime.ts',import.meta.url),'utf8');
 assert.doesNotMatch(runtime,/S3Client|PutObjectCommand|GetObjectCommand/);
});

test('bucket adapter permits only exact event names and always makes conditional writes',async()=>{
 const calls=[];const body=encryptProtection(event,key),name=protectionObjectKey(event,key);
 const objects=createBucketObjects({async send(command){calls.push(command);return {ContentLength:body.length,Body:(async function*(){yield body;})()};}},'isolated-bucket');
 await objects.putIfAbsent(name,body);assert.equal(calls[0].constructor.name,'PutObjectCommand');
 assert.equal(calls[0].input.IfNoneMatch,'*');assert.equal(calls[0].input.Bucket,'isolated-bucket');
 assert.deepEqual(await objects.read(name),body);assert.equal(calls[1].constructor.name,'GetObjectCommand');
 await assert.rejects(objects.putIfAbsent('resolute/backups/example',body));
 await assert.rejects(objects.read(name+'?delete'));assert.equal(calls.length,2);
 const tooLarge=createBucketObjects({async send(){return {ContentLength:40,Body:(async function*(){yield Buffer.alloc(2049);})()};}},'isolated-bucket');
 await assert.rejects(tooLarge.read(name));
});
test('writer bounds concurrent storage requests',async t=>{
 const body=encryptProtection(event,key);let release,entered;
 const started=new Promise(resolve=>{entered=resolve;});
 const server=createWriter({key,token,maxConcurrent:1,objects:{async read(){entered();return new Promise(resolve=>{release=()=>resolve(body);});}}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const url=`http://127.0.0.1:${server.address().port}/v1/events/${protectionObjectKey(event,key).split('/').at(-1)}`;
 const first=fetch(url,{headers:{authorization:`Bearer ${token}`}});await started;
 try {const second=await fetch(url,{headers:{authorization:`Bearer ${token}`}});assert.equal(second.status,503);await second.arrayBuffer();}
 finally{release();}
 const response=await first;assert.equal(response.status,200);await response.arrayBuffer();
});
