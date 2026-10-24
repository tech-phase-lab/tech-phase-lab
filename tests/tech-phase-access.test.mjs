import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxMemberAllowed } from '../services/tech-phase-billing/access.mjs';
import { billingGateway, billingBackend } from '../services/tech-phase-billing/transport.mjs';
import { webhookService } from '../services/tech-phase-billing/webhook.mjs';
const owner='user_owner', member='user_Member2';
const cohort={VERCEL_ENV:'preview',TECH_PHASE_PAYPAL_ENV:'sandbox',TECH_PHASE_BILLING_SANDBOX_TEST_USERS:JSON.stringify([member])};
test('additional Sandbox members require an explicit bounded valid cohort',()=>{
 assert.equal(sandboxMemberAllowed({},owner,owner),true);
 assert.equal(sandboxMemberAllowed({},owner,member),false);
 assert.equal(sandboxMemberAllowed(cohort,owner,member),true);
 for(const raw of ['*','null','{}','["*"]','["user_Member2","user_Member2"]','["user_Member2",null]',JSON.stringify(Array.from({length:6},(_,i)=>`user_${i}`)),' '.repeat(1025)]) {
  const config={...cohort,TECH_PHASE_BILLING_SANDBOX_TEST_USERS:raw};
  assert.equal(sandboxMemberAllowed(config,owner,member),false);
  assert.equal(sandboxMemberAllowed(config,owner,owner),true);
 }
 for(const user of [null,undefined,'','user_Other'])assert.equal(sandboxMemberAllowed(cohort,owner,user),false);
 for(const config of [{...cohort,VERCEL_ENV:'production'},{...cohort,TECH_PHASE_PAYPAL_ENV:'live'}])assert.equal(sandboxMemberAllowed(config,owner,member),false);
 const railway={...cohort,VERCEL_ENV:undefined,TECH_PHASE_BILLING_RUNTIME:'railway-sandbox',RAILWAY_GIT_BRANCH:'codex/research-preview'};
 assert.equal(sandboxMemberAllowed(railway,owner,member),true);
 assert.equal(sandboxMemberAllowed({...railway,RAILWAY_GIT_BRANCH:'main'},owner,member),false);
});
test('gateway and backend independently require enrollment and never forward a forged identity',async()=>{
 const config={...cohort,TECH_PHASE_BILLING_SANDBOX_ENABLED:'true',TECH_PHASE_BILLING_SERVICE_TOKEN:'s'.repeat(48),TECH_PHASE_BILLING_SERVICE_URL:'https://pro-test.up.railway.app'};
 const backendConfig={...config,TECH_PHASE_BILLING_RUNTIME:'railway-sandbox',RAILWAY_GIT_BRANCH:'codex/research-preview'};
 let actualUser=member, seen=[];
 const backend=billingBackend({env:backendConfig,ownerId:owner,services:()=>({store:{summary:async id=>{seen.push(id);return {plan:'free'};}}})});
 const gateway=billingGateway({env:config,ownerId:owner,identity:async()=>actualUser,fetcher:(url,options)=>backend(new Request(url,options))});
 const request=()=>new Request('https://preview.test/api/status',{headers:{'x-tech-phase-user':owner,authorization:'Bearer forged'}});
 assert.equal((await gateway(request(),'status')).status,200);
 assert.deepEqual(seen,[member]);
 actualUser='user_Other';assert.equal((await gateway(request(),'status')).status,403);
 actualUser=member;delete backendConfig.TECH_PHASE_BILLING_SANDBOX_TEST_USERS;
 assert.equal((await gateway(request(),'status')).status,403);
 assert.deepEqual(seen,[member]);
});
test('signed notifications resolve the enrolled ledger owner; unknown members remain ignored',async()=>{
 let user=member,verified=true;const reconciled=[],holds=[];
 const hook=webhookService({ownerId:owner,allowedUser:id=>sandboxMemberAllowed(cohort,owner,id),
  paypal:{verify:async()=>verified},
  store:{findSubscription:async()=>({user_id:user,id:'local-id'}),findPayment:async()=>({user_id:user,id:'local-id'}),holdTransaction:async id=>holds.push(id),hold:async id=>holds.push(id)},
  reconciliation:{reconcile:async(id)=>{reconciled.push(id);return {status:'verified'};}}});
 const paid={id:'WH-paid',event_type:'PAYMENT.SALE.COMPLETED',resource:{billing_agreement_id:'I-ABCDEFGHIJKL',user_id:owner}};
 assert.equal((await hook(new Headers(),paid)).status,'verified');assert.deepEqual(reconciled,[member]);
 const refund={id:'WH-refund',event_type:'PAYMENT.SALE.REFUNDED',resource:{sale_id:'TX-member'}};
 assert.equal((await hook(new Headers(),refund)).status,'review-required');assert.deepEqual(holds,['TX-member',member]);
 user='user_Other';assert.equal((await hook(new Headers(),paid)).status,'ignored');assert.equal((await hook(new Headers(),refund)).status,'ignored');
 verified=false;await assert.rejects(hook(new Headers(),paid),/SIGNATURE/);
 assert.deepEqual(reconciled,[member]);assert.equal(holds.length,2);
});
