import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createResendAlertProvider} from '../lib/resolute/notification-resend.ts';
import {createResendAlertDelivery} from '../lib/resolute/notification-resend-delivery.ts';
const hash=v=>createHash('sha256').update(v).digest('hex');
const key='user_buyer:2027-02-04:alerts',id='4ef9a417-02e9-4d39-ad75-9611e0fcc33c',from='alerts@mail.example.test',to='buyer@example.test';
const now=()=>new Date('2027-02-03T22:01:00Z');
const config={apiKey:'re_test_only_not_a_real_key',from,enabled:true};
const input={key,to,mail:{subject:'Approved subject',text:'Approved text'}};
const result=()=>({object:'email',id,from,to:[to],cc:[],bcc:[],created_at:'2027-02-03 22:00:00.123456+00',last_event:'sent',scheduled_at:null,tags:[{name:'resolute_key',value:hash(key)}]});
function fixture(){let reference=null;const observations=[],requests=[];let reply=result(),failGet=false,failPost=false;
 const evidence={read:async()=>reference,bind:async(k,r)=>{assert.equal(k,key);reference=r;},observe:async(k,i,r)=>{assert.equal(k,key);assert.equal(i,id);observations.push(r);}};
 const transport=async(url,init)=>{requests.push({url,init});assert.equal(new URL(url).origin,'https://api.resend.com');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.ok(init.signal instanceof AbortSignal);
 if(init.method==='POST'){if(failPost)throw Error('private provider error');return Response.json({id});}if(failGet)throw Error('private read error');return Response.json(reply);};
 return {evidence,observations,requests,provider:createResendAlertProvider(config,evidence,transport,now),setReply:r=>reply=r,setGetFail:v=>failGet=v,setPostFail:v=>failPost=v};}
const signal=()=>new AbortController().signal;
test('Resend sends approved text unchanged and persists opaque binding before original receipt lookup',async()=>{
 const f=fixture(),receipt=await f.provider.send(input,signal());
 assert.deepEqual(receipt,{key,messageId:id,acceptedAt:'2027-02-03T22:00:00.123Z'});
 const body=JSON.parse(f.requests[0].init.body);assert.equal(body.text,input.mail.text);assert.equal(body.subject,input.mail.subject);assert.deepEqual(body.to,[to]);assert.equal(body.tags[0].value,hash(key));assert.ok(!f.requests[0].init.headers['Idempotency-Key'].includes('user_buyer'));
 assert.deepEqual(f.observations[0],{status:'sent',acceptedAt:receipt.acceptedAt,checkedAt:now().toISOString()});
 assert.ok(!JSON.stringify(await f.evidence.read(key)).includes(to));
 await f.provider.send(input,signal());assert.equal(f.requests.filter(r=>r.init.method==='POST').length,1);
});
test('GET outage resumes through stored ID; unknown POST outcome cannot trigger a resend via lookup',async()=>{
 const f=fixture();f.setGetFail(true);await assert.rejects(()=>f.provider.send(input,signal()),/^Error: Mail provider unavailable$/);assert.ok(await f.evidence.read(key));
 f.setGetFail(false);await f.provider.lookup(key,signal());assert.equal(f.requests.filter(r=>r.init.method==='POST').length,1);
 const lost=fixture();lost.setPostFail(true);await assert.rejects(()=>lost.provider.send(input,signal()),/^Error: Mail provider unavailable$/);
 assert.equal(await lost.provider.lookup(key,signal()),null);assert.equal(lost.requests.length,1);
});
test('status polling distinguishes server delivery, delay, failure and complaint without sending',async()=>{
 const f=fixture();await f.provider.send(input,signal());
 for(const event of ['delivered','delivery_delayed','bounced','failed','complained','suppressed','opened','clicked','future-type']){
  f.setReply({...result(),last_event:event});const r=await f.provider.inspect(key,signal());assert.equal(r.status,['opened','clicked','future-type'].includes(event)?'unknown':event);
 }
 assert.equal(f.requests.filter(r=>r.init.method==='POST').length,1);
});
test('foreign receipts, malformed responses and addresses fail closed without secret details',async()=>{
 const f=fixture();await f.provider.send(input,signal());
 for(const patch of [{id:'other'},{object:'other'},{from:'foreign@example.test'},{to:['foreign@example.test']},{to:[to,to]},{cc:[to]},{bcc:[to]},{tags:[]},{tags:[{name:'resolute_key',value:hash('other')}]},{scheduled_at:'2027-02-05'},{created_at:'2027-02-03T22:00:00'},{created_at:'2099-01-01T00:00:00Z'}]){
  f.setReply({...result(),...patch});await assert.rejects(()=>f.provider.lookup(key,signal()),/^Error: Mail provider unavailable$/);
 }
 const before=f.requests.length;for(const patch of [{to:'a@example.test\r\nBcc:b@example.test'},{key:'foreign'},{mail:{subject:'x\r\nBcc:y',text:'x'}},{mail:{subject:'x',text:'x'.repeat(60001)}}])await assert.rejects(()=>f.provider.send({...input,...patch},signal()));assert.equal(f.requests.length,before);
});
test('disabled composition makes zero DB, Clerk and provider calls; adapters never retry HTTP errors',async()=>{
 const fail=()=>{throw Error('unexpected I/O');};
 const send=createResendAlertDelivery({connect:fail},{apiKey:'',from:'',publicOrigin:'',stopKey:Buffer.alloc(0),clerk:{users:{getUser:fail}}});assert.equal(await send('user_buyer',key),'disabled');
 const disabled=createResendAlertProvider({...config,enabled:false},{read:fail,bind:fail,observe:fail},fail,now);await assert.rejects(()=>disabled.send(input,signal()));await assert.rejects(()=>disabled.lookup(key,signal()));
 for(const response of [()=>Response.json({error:'secret'},{status:429}),()=>Response.json({error:'secret'},{status:500}),()=>new Response('x'),()=>Response.json({id:'https://evil.test'}),()=>Response.json({large:'x'.repeat(262145)})]){
  let calls=0;const f=fixture();const p=createResendAlertProvider(config,f.evidence,async()=>{calls++;return response();},now);await assert.rejects(()=>p.send(input,signal()),/^Error: Mail provider unavailable$/);assert.equal(calls,1);
 }
});
