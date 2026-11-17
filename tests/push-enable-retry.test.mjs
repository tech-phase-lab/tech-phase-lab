import test from 'node:test';
import assert from 'node:assert/strict';
import {enablePushDevice, staleSubscription, readyWithin, PushEnableError, PUSH_ENABLE_RETRY_MS} from '../lib/research/push-subscribe.ts';

// Nov 17 (owner's iPhone): off then on failed on the first tap. The enable step's own rules, without the page.
const key=Uint8Array.from([4,1,2,3]);
const sub=(extra={})=>({endpoint:'e',unsubscribe:async()=>true,...extra});
test('only a subscription for another server key, or an expired one, is stale', () => {
 assert.equal(staleSubscription(sub(),key),false);
 assert.equal(staleSubscription(sub({options:{applicationServerKey:key.buffer.slice(0)}}),key),false);
 assert.equal(staleSubscription(sub({options:{applicationServerKey:Uint8Array.from([4,9,9,9]).buffer}}),key),true);
 assert.equal(staleSubscription(sub({expirationTime:1}),key,2),true);
 assert.equal(staleSubscription(sub({expirationTime:null}),key),false);
});
function rig({failures=[],existing=null}={}){
 const log=[],reports=[],waits=[];let held=existing;
 const registration={pushManager:{getSubscription:async()=>{log.push('get');return held;},subscribe:async()=>{log.push('subscribe');const f=failures.shift();if(f)throw f;held=sub({endpoint:'fresh'});return held;}}};
 const run=()=>enablePushDevice({prepare:async attempt=>{log.push(['prepare',attempt]);return registration;},key,
  register:async s=>{log.push(['register',s.endpoint]);return {registered:true};},wait:async ms=>{waits.push(ms);},report:r=>reports.push(r)});
 return {log,reports,waits,run};
}
test('a transient subscribe failure is retried once on the ready worker after 800 ms', async () => {
 const r=rig({failures:[new DOMException('x','AbortError')]});
 const out=await r.run();
 assert.equal(out.attempts,2);assert.deepEqual(r.waits,[PUSH_ENABLE_RETRY_MS]);assert.equal(PUSH_ENABLE_RETRY_MS,800);
 assert.deepEqual(r.log,[['prepare',1],'get','subscribe',['prepare',2],'get','subscribe',['register','fresh']]);
 assert.deepEqual(r.reports,[{stage:'subscribe',name:'AbortError',retry:'ok'}]);
});
test('a stale subscription is unsubscribed before subscribing again; a permission refusal is never retried', async () => {
 const stale=sub({endpoint:'stale',options:{applicationServerKey:Uint8Array.from([9]).buffer}});
 const withStale=rig({existing:stale});
 stale.unsubscribe=async()=>{withStale.log.push('unsubscribe');return true;};
 await withStale.run();
 assert.deepEqual(withStale.log,[['prepare',1],'get','unsubscribe','subscribe',['register','fresh']]);
 const denied=rig({failures:[new DOMException('x','NotAllowedError')]});
 await assert.rejects(denied.run(),e=>e instanceof PushEnableError&&e.stage==='subscribe'&&e.errorName==='NotAllowedError');
 assert.deepEqual(denied.waits,[]);assert.deepEqual(denied.reports,[{stage:'subscribe',name:'NotAllowedError',retry:'none'}]);
});
test('readyWithin gives up with a TimeoutError instead of waiting forever', async () => {
 await assert.rejects(readyWithin(new Promise(()=>{}),1,fn=>fn()),{name:'TimeoutError'});
 await assert.rejects(readyWithin(undefined),{name:'InvalidStateError'});
 assert.equal(await readyWithin(Promise.resolve('reg'),1000,()=>{}),'reg');
});
