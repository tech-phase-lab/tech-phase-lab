import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { paymentStore } from '../services/resolute-api/payments/store.mjs';
import { paymentEngine } from '../services/resolute-api/payments/engine.mjs';
import { guestIdentity } from '../services/resolute-api/payments/guest.mjs';
import { recoveryTokens, recoveryMail, RECOVERY_LIFETIME } from '../services/resolute-api/payments/recovery.mjs';
import { receiptWorker, receiptProvider } from '../services/resolute-api/payments/receipt-mail.mjs';
import { quote } from '../services/resolute-api/payments/policy.mjs';

const base=Date.parse('2026-10-28T00:00:00.123Z'),key='a'.repeat(64),hash=s=>createHash('sha256').update(s).digest('hex');
test('recovery links are signed, order-scoped, expiring and absent from query strings',()=>{
 const tokens=recoveryTokens(key,()=>base),o={id:randomUUID(),paid_at:new Date(base).toISOString(),quote:{language:'ja'}};
 const token=tokens.issue(o);assert.equal(tokens.read(token).id,o.id);
 for(const invalid of [null,'',o.id,token.slice(0,-3)+'aaa',token+'.x']) assert.throws(()=>tokens.read(invalid));
 assert.throws(()=>recoveryTokens('b'.repeat(64),()=>base).read(token));
 assert.throws(()=>recoveryTokens(key,()=>base+RECOVERY_LIFETIME).read(token),/RECOVERY_EXPIRED/);
 assert.throws(()=>recoveryTokens(key,()=>base-6000).read(token));
 for(const language of ['ja','en']) {
  const mail=recoveryMail({...o,quote:{language}},token,'https://techphase.app');
  const link=mail.text.match(/https:\/\/\S+/)[0],url=new URL(link);
  assert.equal(url.hash,'#'+token);assert.ok(!url.search.includes(token));
  assert.ok(mail.text.includes(o.id));assert.ok(mail.text.includes('30'));
 }
 assert.throws(()=>recoveryMail(o,token,'https://techphase.app/redirect'));
});

test('receipt queue and recovery claims preserve verified ownership and avoid ambiguous resends',async t=>{
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();
 const db=new PGlite({database:'resolute',loadDataDir:data});t.after(()=>db.close());
 for(const f of ['014_payments_live.sql','015_payments_live_role.sql','021_guest_payments.sql','022_guest_receipt_queue.sql','023_guest_receipt_sender.sql'])
  await db.exec(await readFile(new URL('../db/resolute/'+f,import.meta.url),'utf8'));
 const query=db.query.bind(db),pool={query,connect:async()=>({query,release(){}})},store=paymentStore(pool,{environment:'live'});
 let clock=base,sends=0,fail=false,event='delivered';const sent=[];
 const tokens=recoveryTokens(key,()=>clock),provider={from:'receipts@example.test',send:async(id,to,mail)=>{sends++;sent.push({id,to,mail});if(fail)throw Error('uncertain network');return randomUUID();},inspect:async()=>event};
 const paypal={get:async id=>{
  const o=await store.findPaypal(id),amount={currency_code:o.quote.currency,value:o.quote.value};
  return {id,status:'COMPLETED',intent:'CAPTURE',payer:{email_address:'buyer@example.test'},purchase_units:[{reference_id:o.id,invoice_id:o.id,custom_id:o.id,
   payee:{merchant_id:'MERCHANT1234'},amount,items:[{sku:o.quote.sku,quantity:'1',unit_amount:amount}],
   payments:{captures:[{id:o.capture_id,status:'COMPLETED',final_capture:true,amount,create_time:o.paid_at}]}}]};
 }};
 const run=receiptWorker({pool,paypal,provider,tokens,origin:'https://techphase.app',merchantId:'MERCHANT1234',enabled:true,now:()=>clock});
 const row=async id=>(await query('SELECT * FROM resolute_payments_live.guest_receipts WHERE order_id=$1',[id])).rows[0];
 const ready=async()=>{
  const guest=guestIdentity(hash(randomUUID()));let o=await store.create(guest,randomUUID(),r=>quote('initial','ja',{pro:false},r,clock),clock);
  o=await store.bind(o,'ORDER'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase());
  o=await store.prepare(o,{proUntil:null},clock,()=>{});
  const payment={captureId:'CAP'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase(),paidAt:new Date(clock).toISOString()};
  await store.paid(o,payment);await store.paid(o,payment);
  await query('UPDATE resolute_payments_live.guest_receipts SET next_check_at=$2 WHERE order_id=$1',[o.id,new Date(clock)]);
  return store.get(o.id);
 };
 const engine=paymentEngine({store,environment:'live',allowGuest:()=>true,canCharge:()=>false,recovery:tokens,now:()=>clock,
  getUser:async id=>({id,primaryEmailAddressId:'verified',emailAddresses:[{id:'verified',verification:{status:'verified'}}]})});
 let first;
 await t.test('disabled sender never reads database or calls provider',async()=>{
  const report=await receiptWorker({enabled:false,pool:{query(){throw Error('must not read');}}})();assert.equal(report.enabled,false);
 });
 await t.test('verified capture queues exactly one email and sending is distinct from delivery',async()=>{
  first=await ready();assert.equal((await row(first.id)).state,'ready');
  await db.exec('SET ROLE resolute_payment_live_writer');
  try{await query('UPDATE resolute_payments_live.orders SET state=state WHERE id=$1',[first.id]);}
  finally{await db.exec('RESET ROLE');}
  assert.equal((await query('SELECT * FROM resolute_payments_live.guest_receipts')).rows.length,1);
  let result=await run();assert.equal(result.accepted,1);assert.equal(result.delivered,0);assert.equal(sends,1);
  assert.equal(sent[0].to,'buyer@example.test');assert.ok(sent[0].mail.text.includes('#'));
  assert.equal((await row(first.id)).state,'accepted');
  assert.ok(!JSON.stringify(await row(first.id)).includes('buyer@example.test'));
  assert.ok(!JSON.stringify(await row(first.id)).includes(tokens.issue(first)));
  clock+=11*60000;result=await run();assert.equal(result.delivered,1);assert.equal(sends,1);
 });
 await t.test('email capability works on another browser without the original guest cookie, once per account',async()=>{
  const token=tokens.issue(first);
  await assert.rejects(engine.claimRecovery('user_receiver',token,{orderId:randomUUID()}),/INVALID_RECOVERY_LINK/);
  assert.equal((await engine.claimRecovery('user_receiver',token,{orderId:first.id})).state,'claimed');
  assert.equal((await engine.claimRecovery('user_receiver',token,{orderId:first.id})).state,'already-claimed');
  await assert.rejects(engine.claimRecovery('user_other',token,{orderId:first.id}),/ORDER_NOT_FOUND/);
  const g=(await query('SELECT * FROM resolute_payments_live.grants WHERE order_id=$1',[first.id])).rows[0];
  assert.equal(new Date(g.starts_at).getTime(),base);assert.equal(new Date(g.expires_at).toISOString(),'2027-10-28T00:00:00.123Z');
 });
 await t.test('refund or dispute blocks token redemption before or after a claim',async()=>{
  await store.adverse(first.paypal_id,'revoked','REFUND','event1');
  await assert.rejects(engine.claimRecovery('user_receiver',tokens.issue(first),{orderId:first.id}),/PAYMENT_REVIEW_REQUIRED/);
  const o=await ready();await store.adverse(o.paypal_id,'suspended','DISPUTE','event2');
  await assert.rejects(engine.claimRecovery('user_other',tokens.issue(o),{orderId:o.id}),/PAYMENT_REVIEW_REQUIRED/);
  await run();assert.equal((await row(o.id)).state,'closed');assert.equal(sends,1);
 });
 await t.test('a timed-out send is retained for review and never automatically resent',async()=>{
  const o=await ready();fail=true;
  assert.equal((await run()).uncertain,1);assert.equal((await row(o.id)).state,'uncertain');const count=sends;
  fail=false;clock+=2*86400000;await run();assert.equal(sends,count);assert.ok((await run()).needsReview>=1);
 });
 await t.test('accepted receipt reconciliation uses only inspection; bounced recipient is blocked',async()=>{
  const o=await ready();await run();const count=sends;event='bounced';clock+=11*60000;
  await run();assert.equal(sends,count);assert.equal((await row(o.id)).last_event,'bounced');
  const next=await ready();await run();assert.equal(sends,count);assert.equal((await row(next.id)).state,'blocked');
 });
 await t.test('an expired link cannot grant access and sender role cannot mutate payment ownership',async()=>{
  clock=base+RECOVERY_LIFETIME;await assert.rejects(engine.claimRecovery('user_late',tokens.issue({...first,paid_at:new Date(clock-1000).toISOString()}),{orderId:first.id}),/INVALID_RECOVERY_LINK/);
  await db.exec('SET ROLE resolute_guest_mail_sender');
  try{await assert.rejects(query('UPDATE resolute_payments_live.orders SET user_id=$1 WHERE id=$2',['user_thief',first.id]),/permission denied/);
   await assert.rejects(query('INSERT INTO resolute_payments_live.grants(order_id,user_id,kind,starts_at,expires_at) VALUES($1,$2,$3,$4,$5)',[randomUUID(),'user_thief','initial',new Date(base),new Date(clock)]),/permission denied/);
  }finally{await db.exec('RESET ROLE');}
 });
});

test('Resend adapter pins API and receipt correlation and refuses unrelated delivery evidence',async()=>{
 const id=randomUUID(),order=randomUUID(),calls=[],from='receipts@example.test',to='buyer@example.test';
 let bad=false;
 const provider=receiptProvider({apiKey:'re_fixture012345',from},async(url,options)=>{
  calls.push({url,options});assert.ok(url.startsWith('https://api.resend.com/'));assert.equal(options.redirect,'error');
  if(options.method==='POST'){const b=JSON.parse(options.body);assert.deepEqual(b.to,[to]);assert.equal(options.headers['Idempotency-Key'],'resolute-receipt-'+order);return Response.json({id});}
  return Response.json({id,object:'email',from,to:[bad?'other@example.test':to],tags:[{name:'resolute_receipt',value:order}],last_event:'delivered'});
 });
 assert.equal(await provider.send(order,to,{subject:'RESOLUTE',text:'fixture'}),id);
 const row={provider_id:id,order_id:order,from_hash:hash(from),recipient_hash:hash(to)};
 assert.equal(await provider.inspect(row),'delivered');bad=true;await assert.rejects(provider.inspect(row),/mismatch/);
 assert.equal(calls.filter(c=>c.options.method==='POST').length,1);
 await assert.rejects(provider.inspect({...row,provider_id:'../../other'}));
});
