import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyMailFeedback,parseMailFeedback,createMailFeedbackRoute} from '../lib/resolute/notification-feedback.ts';
import {createMailFeedbackRuntime} from '../lib/resolute/notification-feedback-runtime.ts';
import {createMailMonitor} from '../lib/resolute/notification-mail-monitor.ts';
const secret='whsec_'+Buffer.alloc(32,7).toString('base64'),now=new Date('2027-02-03T22:00:00Z');
const body={type:'email.delivered',created_at:now.toISOString(),data:{created_at:now.toISOString(),email_id:'4ef9a417-02e9-4d39-ad75-9611e0fcc33c',from:'alerts@mail.example.test',to:['buyer@example.test'],tags:{resolute_key:'a'.repeat(64)}}};
function request(payload=JSON.stringify(body),overrides={}){
 const time=String(now.getTime()/1000),id='msg_fixture';
 const signature=createHmac('sha256',Buffer.alloc(32,7)).update(id+'.'+time+'.'+payload).digest('base64');
 return new Request('https://api.test/webhooks/resend',{method:'POST',body:payload,headers:{'content-type':'application/json','svix-id':id,'svix-timestamp':time,'svix-signature':'v1,'+signature,...overrides}});
}
test('Svix official signature vector and raw byte integrity',()=>{
 const raw=Buffer.from('{"event_type":"ping","data":{"success":true}}');
 const headers=new Headers({'svix-id':'msg_loFOjxBNrRLzqYUf','svix-timestamp':'1731705121','svix-signature':'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0='});
 assert.equal(verifyMailFeedback(raw,headers,'whsec_plJ3nmyCDGBKInavdOK15jsl',new Date(1731705121000)).body.event_type,'ping');
 assert.throws(()=>verifyMailFeedback(Buffer.concat([raw,Buffer.from(' ')]),headers,'whsec_plJ3nmyCDGBKInavdOK15jsl',new Date(1731705121000)));
 assert.throws(()=>verifyMailFeedback(raw,headers,'whsec_plJ3nmyCDGBKInavdOK15jsl',new Date(1731705521000)));
});
test('verified route bounds input and never consumes unsigned, stale or malformed events',async()=>{
 const seen=[];const route=createMailFeedbackRoute({enabled:()=>true,secret,from:body.data.from,now:()=>now,consume:async e=>seen.push(e)});
 assert.equal((await route(request())).status,200);assert.equal(seen.length,1);assert.ok(!JSON.stringify(seen).includes('buyer@example.test'));
 for(const req of [request(undefined,{'svix-signature':'v1,bad'}),request(undefined,{'svix-timestamp':'1'}),request('{'),request(JSON.stringify({...body,data:{...body.data,to:['other@example.test','buyer@example.test']}}))])assert.equal((await route(req)).status,400);
 assert.equal((await route(request(' '.repeat(65537)))).status,413);assert.equal(seen.length,1);
 assert.equal(await route(new Request('https://api.test/elsewhere')),null);
});
test('foreign sender, missing correlation and event chronology',()=>{
 assert.throws(()=>parseMailFeedback('msg_x',body,'other@example.test',now));
 assert.equal(parseMailFeedback('msg_x',{...body,data:{...body.data,tags:{}}},body.data.from,now),null);
 assert.throws(()=>parseMailFeedback('msg_x',{...body,created_at:'2027-02-03T21:00:00Z'},body.data.from,now));
});
test('runtime and monitor default off without database or network',async()=>{
 assert.equal((await createMailFeedbackRuntime({})(request())).status,503);
 const monitor=createMailMonitor({connect:async()=>assert.fail('DB must not open')},{apiKey:'',from:''});
 assert.deepEqual(await monitor(),{enabled:false,checked:0,delivered:0,pending:0,failed:0,unavailable:0,incomplete:false});
});
test('monitor bounds batches, reports pending instead of success, and releases its connection',async()=>{
 let writes=0,released=false,queries=0;
 const client={query:async(sql)=>{queries++;
  if(sql.includes('LIMIT 26'))return {rows:Array.from({length:26},(_,i)=>({clerk_user_id:'user_'+i,idempotency_key:'user_'+i+':2027-02-04:alerts'}))};
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
  if(sql.includes('SELECT payload'))return {rows:[{payload:{reservation:{status:'queued'}}}]};
  if(sql.includes('UPDATE'))writes++;
  return {rows:[]};
 },release:()=>{released=true;}};
 const report=await createMailMonitor({connect:async()=>client},{enabled:true,apiKey:'',from:'',request:async()=>assert.fail('No send or lookup without provider ID'),now:()=>now})();
 assert.equal(report.checked,25);assert.equal(report.pending,25);assert.equal(report.incomplete,true);assert.equal(writes,25);assert.equal(released,true);assert.ok(queries<110);
});
test('monitor flags busy users as incomplete and never releases an unowned lock',async()=>{
 const client={query:async(sql)=>{
  if(sql.includes('LIMIT 26'))return {rows:[{clerk_user_id:'user_a',idempotency_key:'user_a:2027-02-04:alerts'}]};
  assert.match(sql,/pg_try_advisory_lock/);return {rows:[{locked:false}]};
 },release:()=>{}};
 const result=await createMailMonitor({connect:async()=>client},{enabled:true,apiKey:'',from:''})();
 assert.equal(result.incomplete,true);assert.equal(result.checked,0);
});
