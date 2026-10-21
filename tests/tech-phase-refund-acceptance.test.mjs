import test from 'node:test';
import assert from 'node:assert/strict';
import {runUsdRefundAcceptance} from '../scripts/tech-phase/sandbox-usd-refund-acceptance.mjs';
function fixture() {
 const usd={id:'00000000-0000-4000-8000-000000000001',paypal_id:'I-USDABCDEFGHI',currency:'USD',minor:2000,state:'active',transaction_id:'TX-USD-TEST',paid_at:'2026-10-20T15:24:34Z',period_end:'2026-11-21T10:00:00Z',held:false,adverse:false};
 const jpy={currency:'JPY',minor:2980,state:'cancelled',period_end:'2026-11-20T10:00:00Z',held:false,adverse:false};
 const f={rows:[jpy,usd],state:'ACTIVE',saleState:'completed',saleAmount:'20.00',paymentAmount:'20.0',plan:'P-1HN77466YK762545WNLLQDHI',calls:[],logs:[],sql:[],cancelFails:false,refundLost:false};
 const env={TECH_PHASE_PROVISION_ACTION:'execute-usd-refund',TECH_PHASE_DISCOVERY_ENV:'sandbox',TECH_PHASE_PROVISION_DB_URL:'RETIRED'};
 for(const k of ['TECH_PHASE_BACKUP_DB_PASSWORD','TECH_PHASE_DISCOVERY_CLIENT_ID','TECH_PHASE_DISCOVERY_CLIENT_SECRET','TECH_PHASE_CHECK_TOKEN'])env[k]='fake-secret-for-offline-tests';
 class Client {constructor(config){assert.equal(config.user,'tech_phase_billing_sandbox_backup');}async connect(){}async end(){}async query(q){f.sql.push(q);return {rows:q.includes('current_database')?[{db:'tech_phase_billing_sandbox',role:'tech_phase_billing_sandbox_backup',ro:'on'}]:q.includes('SELECT s.id')?f.rows:[]};}}
 const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 const fetcher=async(url,opts)=>{
  f.calls.push({url,method:opts.method,key:opts.headers['PayPal-Request-Id']});
  if(url.endsWith('/token'))return json({access_token:'fake-oauth-token'});
  if(url.includes('/transactions?'))return json({transactions:[{id:usd.transaction_id,time:usd.paid_at}]});
  if(url.endsWith('/sandbox/status'))return json({environment:'sandbox',subscription:{id:usd.id},plan:'pro',proExpiresAt:usd.period_end,reviewRequired:false});
  if(url.endsWith('/sandbox/cancel')){if(f.cancelFails)return json({},503);f.state='CANCELLED';return json({status:'cancelled'});}
  if(url.endsWith('/refund')){if(f.refundLost)throw Error('lost response');f.saleState='refunded';return json({sale_id:usd.transaction_id,amount:{currency:'USD',total:'20.00'},state:'completed'});}
  if(url.includes('/payments/sale/'))return json({id:usd.transaction_id,amount:{currency:'USD',total:f.saleAmount},state:f.saleState});
  return json({id:usd.paypal_id,custom_id:usd.id,plan_id:f.plan,status:f.state,billing_info:{last_payment:{time:usd.paid_at,amount:{currency_code:'USD',value:f.paymentAmount}}}});
 };
 f.args={env,Client,fetcher,now:()=>Date.parse('2026-10-21T02:30:00Z'),log:s=>f.logs.push(JSON.parse(s))};
 f.refunds=()=>f.calls.filter(c=>c.url.endsWith('/refund'));
 return f;
}
test('one-time USD refund verifies ledger and provider before cancellation and one idempotent refund',async()=>{
 const f=fixture();await runUsdRefundAcceptance(f.args);
 assert.equal(f.state,'CANCELLED');assert.equal(f.refunds().length,1);
 assert.equal(f.refunds()[0].key,'7b13c37d-73c7-40e2-87d8-76279d918972');
 assert.ok(f.sql.includes('BEGIN READ ONLY'));assert.ok(f.sql.includes('COMMIT'));
 assert.equal(f.logs.at(-1).state,'refunded');
 assert.doesNotMatch(JSON.stringify(f.logs),/fake-secret|I-USD|TX-USD|user_/);
});
test('one-time refund rejects wrong environment, expired action, ledger, plan or amount before mutation',async()=>{
 for(const change of [f=>f.args.env.TECH_PHASE_DISCOVERY_ENV='live',f=>f.args.now=()=>Date.parse('2026-10-22Z'),f=>f.rows[1].minor=1999,f=>f.rows[0].held=true,f=>f.plan='P-WRONG',f=>f.saleAmount='200.00']){
  const f=fixture();change(f);await assert.rejects(runUsdRefundAcceptance(f.args));
  assert.equal(f.calls.filter(c=>c.url.endsWith('/cancel')||c.url.endsWith('/refund')).length,0);
 }
});
test('inspection and already-refunded execution never submit a refund',async()=>{
 for(const action of ['inspect-usd-refund','observe-usd-refund']){const f=fixture();f.args.env.TECH_PHASE_PROVISION_ACTION=action;await runUsdRefundAcceptance(f.args);assert.equal(f.refunds().length,0);assert.equal(f.state,'ACTIVE');}
 const f=fixture();f.state='CANCELLED';f.saleState='refunded';await runUsdRefundAcceptance(f.args);assert.equal(f.refunds().length,0);
});
test('failed cancellation prevents refund and lost refund response is never retried',async()=>{
 const f=fixture();f.cancelFails=true;await assert.rejects(runUsdRefundAcceptance(f.args),/BILLING_HTTP_503/);assert.equal(f.refunds().length,0);
 const g=fixture();g.refundLost=true;await assert.rejects(runUsdRefundAcceptance(g.args),/lost response/);assert.equal(g.refunds().length,1);
});

test('PayPal decimal formatting accepts exactly 20 USD and rejects changed amounts',async()=>{
 for(const amount of ['20','20.0','20.00']){const f=fixture();f.paymentAmount=amount;f.saleAmount=amount;await runUsdRefundAcceptance(f.args);assert.equal(f.refunds().length,1);}
 for(const amount of ['20.01','200','2e1',' 20.00','20.000',20]){const f=fixture();f.paymentAmount=amount;await assert.rejects(runUsdRefundAcceptance(f.args),/PROVIDER_PAYMENT/);assert.equal(f.refunds().length,0);}
});

test('one-time authorization uses explicit UTC boundaries and excludes the expiry instant',async()=>{
 for(const time of ['2026-10-20T23:59:59.999Z','2026-10-21T04:00:00Z','2026-10-21T13:00:00+09:00']){
  const f=fixture();f.args.now=()=>Date.parse(time);await assert.rejects(runUsdRefundAcceptance(f.args),/EXPIRED/);assert.equal(f.calls.length,0);
 }
 for(const time of ['2026-10-21T00:00:00Z','2026-10-21T12:59:59.999+09:00']){
  const f=fixture();f.args.env.TECH_PHASE_PROVISION_ACTION='inspect-usd-refund';f.args.now=()=>Date.parse(time);await runUsdRefundAcceptance(f.args);assert.equal(f.refunds().length,0);
 }
});
