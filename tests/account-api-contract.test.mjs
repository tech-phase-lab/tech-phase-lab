import test from 'node:test';
import assert from 'node:assert/strict';
import {accountContract} from '../services/tech-phase-billing/account-view.mjs';
import {profileInput,selectedIcon,accountIcons} from '../lib/account/profile.ts';
import {deliveryView} from '../lib/account/delivery.ts';
import {liveHandler} from '../services/tech-phase-billing/live-http.mjs';
const local={id:'local',paypal_id:'I-ABCDEFGH',currency:'JPY'};
function fixture(){return {store:{summary:async()=>({plan:'pro',subscription:{id:'local'},proExpiresAt:'2026-11-30T00:00:00Z',reviewRequired:false}),get:async()=>local},plans:{JPY:'plan'},paypal:{getDetails:async()=>({id:local.paypal_id,custom_id:'local',plan_id:'plan',status:'ACTIVE',billing_info:{next_billing_time:'2026-11-30T00:00:00Z'},plan:{billing_cycles:[{tenure_type:'REGULAR',pricing_scheme:{fixed_price:{currency_code:'JPY',value:'2980'}}}]}})}};}
test('account view uses provider amount/date and verified access, no checkout mutation',async()=>{
 const data=await accountContract(fixture(),'user_test');
 assert.equal(data.status,'active');assert.equal(data.amount,'2980');assert.equal(data.nextBillingAt,'2026-11-30T00:00:00.000Z');assert.equal(data.accessPlan,'pro');
});
test('missing provider evidence stays unknown; cancelled does not invent a renewal date',async()=>{
 const f=fixture();f.paypal.getDetails=async()=>({id:local.paypal_id,custom_id:'local',plan_id:'plan',status:'CANCELLED'});
 const data=await accountContract(f,'user_test');assert.equal(data.status,'renewal-stopped');assert.equal(data.autoRenew,false);assert.equal(data.amount,null);assert.equal(data.nextBillingAt,null);assert.equal(data.accessExpiresAt,'2026-11-30T00:00:00.000Z');
 f.paypal.getDetails=async()=>{throw Error('secret-provider-response');};
 const failed=await accountContract(f,'user_test');assert.equal(failed.status,null);assert.equal(failed.autoRenew,null);assert.doesNotMatch(JSON.stringify(failed),/secret-provider/);
});
test('wrong provider binding and review holds never become active or no contract',async()=>{
 const f=fixture();f.paypal.getDetails=async()=>({id:'other',custom_id:'local',plan_id:'plan',status:'ACTIVE'});
 assert.equal((await accountContract(f,'user_test')).status,null);
 const g=fixture();g.store.summary=async()=>({plan:'free',subscription:{id:'local'},reviewRequired:true});
 assert.equal((await accountContract(g,'user_test')).status,null);
});
test('only confirmed absence is no contract; approvals and suspended stay unconfirmed',async()=>{
 const f=fixture();f.store.summary=async()=>({subscription:null});assert.equal((await accountContract(f,'user_test')).status,'none');
 const g=fixture();g.store.get=async()=>({id:'local'});assert.equal((await accountContract(g,'user_test')).verification,'pending');
 const h=fixture();h.paypal.getDetails=async()=>({id:local.paypal_id,custom_id:'local',plan_id:'plan',status:'SUSPENDED'});assert.equal((await accountContract(h,'user_test')).autoRenew,null);
});
test('profile whitelist rejects impersonation and fixed-owner icon changes',()=>{
 for(const icon of accountIcons)assert.equal(profileInput({icon},false).icon,icon);
 for(const input of [{role:'admin'},{icon:'https://image.test/photo'},{displayName:'\u0000x'},{displayName:' '},{userId:'another',icon:'fire'}])assert.throws(()=>profileInput(input,false));
 assert.throws(()=>profileInput({icon:'fire'},true),/owner-icon-fixed/);
 assert.equal(selectedIcon('fire',true),'owner');assert.equal(selectedIcon('bad',false),'initial');assert.equal(selectedIcon('initials',false),'initial');assert.throws(()=>profileInput({icon:'initials'},false));
});
test('delivery aggregates never confuse worker success with a delivered notification or leak endpoints',()=>{
 const result=deliveryView({webPush:{status:'ready',lastSuccessAt:'2026-01-01T00:00:00Z',accepted24Hours:3,failures:4,endpoint:'secret-endpoint',keys:'secret-key'}});
 assert.equal(result.push.lastSentAt,null);assert.equal(result.push.failureCount,null);assert.equal(result.push.successCount,3);assert.doesNotMatch(JSON.stringify(result),/secret/);assert.equal(deliveryView({}).push.successCount,null);assert.equal(deliveryView({webPush:{status:'waiting',accepted24Hours:0}}).push.successCount,null);
});
test('account contract handler authenticates and is read only',async()=>{
 let calls=0;const env={VERCEL_ENV:'production',TECH_PHASE_PAYPAL_ENV:'live',TECH_PHASE_BILLING_LIVE_ENABLED:'true'};
 const handler=liveHandler({env,identity:async()=>null,services:async()=>{calls++;return {};}});
 assert.equal((await handler(new Request('https://site.test/live/account'),'account')).status,401);assert.equal(calls,0);
 const valid=liveHandler({env,identity:async()=>'user_test',services:async()=>({accountContract:async id=>({id})})});
 assert.deepEqual(await(await valid(new Request('https://site.test/live/account'),'account')).json(),{id:'user_test'});
 assert.equal((await valid(new Request('https://site.test/live/account',{method:'POST'}),'account')).status,405);
});
