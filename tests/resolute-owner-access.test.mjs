import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {PRODUCTION_OWNER_ACCOUNT_ID as owner,OWNER_ACCOUNT_ID as developmentOwner} from '../lib/membership/entitlements.ts';
import {OWNER_ISSUER,OWNER_ORIGIN,ownerAccessFromVerifiedSession,ownerAccessFromVerifiedAccount,hasOwnerAccess,ownerAccessSnapshot} from '../lib/resolute/owner-access.ts';
import {authConfig,authenticatePrincipal} from '../services/resolute-api/auth.mjs';
import {createHandler} from '../services/resolute-api/handler.mjs';
import {getResoluteEntitlementsForUser} from '../lib/resolute/database.ts';
import {validateSnapshot} from '../lib/resolute/transport.ts';
import {resolveResoluteEntitlements} from '../lib/resolute/entitlements.ts';
import {createPlanStore,PlanAccessDenied} from '../lib/resolute/plan-database.ts';
import {createNotificationStore,NotificationAccessDenied} from '../lib/resolute/notification-database.ts';
import {defaultNotificationSettings} from '../lib/resolute/notification-settings.ts';
import {emptyPlanAnswers} from '../lib/resolute/plan-answers.ts';
import {createNotificationOutboxJob} from '../lib/resolute/notification-outbox.ts';
import {dispatchNotification} from '../lib/resolute/notification-dispatch.ts';
import {createClerkNotificationRecipient} from '../lib/resolute/notification-recipient.ts';
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const oldPair=generateKeyPairSync('rsa',{modulusLength:2048});
const secret='p'.repeat(64),oldSecret='d'.repeat(64);
const config=authConfig({RESOLUTE_CLERK_ISSUER:'https://test.clerk.accounts.dev',RESOLUTE_CLERK_AUTHORIZED_PARTIES:'["https://preview.example.test"]',
 RESOLUTE_CLERK_JWT_PUBLIC_KEY:oldPair.publicKey.export({type:'spki',format:'pem'}),RESOLUTE_API_SERVICE_TOKEN:oldSecret,
 RESOLUTE_PRODUCTION_API_SERVICE_TOKEN:secret,RESOLUTE_PRODUCTION_CLERK_JWT_PUBLIC_KEY:pair.publicKey.export({type:'spki',format:'pem'})});
const claims=(extra={},now=Date.now())=>({iss:OWNER_ISSUER,azp:OWNER_ORIGIN,sub:owner,sid:'sess_owner',iat:Math.floor(now/1000)-1,nbf:Math.floor(now/1000)-1,exp:Math.floor(now/1000)+60,fva:[0,0],...extra});
function headers(extra={},key=pair.privateKey,credential=secret){
 const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:'owner'})).toString('base64url');
 const p=Buffer.from(JSON.stringify(claims(extra))).toString('base64url');
 const token=`${h}.${p}.${sign('RSA-SHA256',Buffer.from(`${h}.${p}`),key).toString('base64url')}`;
 return new Headers({Authorization:`Bearer ${token}`,'X-Resolute-Service-Token':credential});
}
const account={id:owner,twoFactorEnabled:true,banned:false,locked:false};
test('production owner exception requires verified issuer, origin, identity and MFA; proof cannot be copied or used for another user',async()=>{
 const principal=await authenticatePrincipal(headers(),config);
 assert.equal(hasOwnerAccess(principal.ownerAccess,owner),true);
 assert.equal(hasOwnerAccess({...principal.ownerAccess},owner),false);
 assert.equal(hasOwnerAccess(principal.ownerAccess,'user_buyer'),false);
 assert.equal(hasOwnerAccess(principal.ownerAccess,owner,Date.now()+61000),false);
 for(const patch of [{iss:'https://evil.test'},{azp:'https://evil.test'},{exp:1},{sid:undefined}])assert.equal(await authenticatePrincipal(headers(patch),config),null);
 assert.equal(await authenticatePrincipal(headers({},oldPair.privateKey),config),null);
 assert.equal(await authenticatePrincipal(headers({},pair.privateKey,oldSecret),config),null);
 for(const patch of [{sub:'user_buyer',role:'admin',plan:'pro'},{sub:developmentOwner},{fva:[0,-1]},{fva:undefined},{fva:[0,'0']}]){
  const p=await authenticatePrincipal(headers(patch),config); assert.ok(p);assert.equal(p.ownerAccess,undefined);
 }
 for(const patch of [{twoFactorEnabled:false},{banned:true},{locked:true},{id:'user_other'}])assert.equal(ownerAccessFromVerifiedAccount({...account,...patch},true),undefined);
 assert.equal(ownerAccessFromVerifiedAccount(account,false),undefined);
});
test('entitlements and downstream handler share the owner proof without database purchase reads or synthetic purchases',async()=>{
 const run=createHandler(config,getResoluteEntitlementsForUser,undefined,async(id,method,mutation,proof)=>({allowed:hasOwnerAccess(proof,id)}),
  async(id,method,mutation,proof)=>({allowed:hasOwnerAccess(proof,id)}),async(request,id,read)=>Response.json(await read(id)));
 for(const path of ['entitlements','plan','notification-settings','risk']){
  const r=await run(new Request('https://service.test/internal/v1/'+path,{headers:headers()}));assert.equal(r.status,200);
  const body=await r.json();assert.equal(body.allowed??body.canUseTools,true);
  assert.equal((await run(new Request('https://service.test/internal/v1/'+path,{headers:headers({fva:[0,-1]})}))).status,403);
 }
 const grant=ownerAccessFromVerifiedSession(claims());const snapshot=ownerAccessSnapshot(grant,owner);
 assert.deepEqual(validateSnapshot(snapshot),snapshot);
 assert.equal(snapshot.use.status,'owner');assert.equal(snapshot.alerts.expiresAt,null);
 assert.equal(resolveResoluteEntitlements([],new Date().toISOString()).canUseTools,false);
 assert.throws(()=>validateSnapshot({...snapshot,accessBasis:undefined}));
 assert.throws(()=>validateSnapshot({...snapshot,alerts:{...snapshot.alerts,status:'active'}}));
});
test('owner can save and reread plan/settings and queue notifications with no grants/orders; ordinary users stay denied',async()=>{
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();
 const db=new PGlite({database:'resolute',loadDataDir:data});
 const query=async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0};};
 const pool={query,connect:async()=>({query,release(){}})};
 try{
  for(const f of ['001_entitlements.sql','002_plans.sql','003_plan_answers_fx.sql','004_notification_settings.sql','005_notification_outbox.sql','014_payments_live.sql'])await db.exec(readFileSync(new URL('../db/resolute/'+f,import.meta.url),'utf8'));
  const grant=ownerAccessFromVerifiedSession(claims());
  const plans=createPlanStore(pool,'live'),settings=createNotificationStore(pool,'live');
  const plan={schemaVersion:1,answersVersion:1,answers:emptyPlanAnswers(),fx:{thresholdYen:null,usdJpy:null,note:''},currency:'JPY',monthlyLivingCost:250000,savingsMonths:12,reserveMonths:6,nearTermExpense:0,financialAssets:10000000,investedAmount:3000000,investable:8500000,tolerancePct:20,toleranceDrop:600000,perStockCapPct:20,buyMode:'steps',buyLines:[{dropPct:10,amount:100000},{dropPct:20,amount:100000}],buyBudgetPct:10,allocation:'equal',noBuyConditions:[],haltConditions:[],ruleType:'undecided'};
  assert.equal((await plans(owner,'PUT',{baseRevision:0,plan},grant)).revision,1);
  assert.equal((await plans(owner,'GET',undefined,grant)).plan.currency,'JPY');
  const prefs={...defaultNotificationSettings(),alertsEnabled:true,watchItems:[{symbol:'AAA',referencePrice:100}]};
  assert.equal((await settings(owner,'PUT',{baseRevision:0,settings:prefs},grant)).revision,1);
  assert.equal((await settings(owner,'GET',undefined,grant)).settings.alertsEnabled,true);
  await assert.rejects(plans('user_buyer','GET',undefined,grant),PlanAccessDenied);
  await assert.rejects(settings('user_buyer','GET',undefined,grant),NotificationAccessDenied);
  await assert.rejects(plans(owner,'GET',undefined,{...grant}),PlanAccessDenied);
  const clock=new Date('2026-10-31T22:00:00Z');const background=ownerAccessFromVerifiedAccount(account,true,clock.getTime());
  const job=createNotificationOutboxJob(pool,async()=>({locale:'ja',preferencesConfigured:true,recipientVerified:true,unsubscribed:false,marketDate:'2026-10-30',closes:[{symbol:'AAA',date:'2026-10-30',close:80,isFinal:true}]}),()=>clock,'live',async()=>background);
  assert.equal((await job(owner))[0].status,'queued');
  for(const table of ['resolute.entitlements','resolute_payments_live.orders','resolute_payments_live.grants'])assert.equal((await db.query('SELECT count(*) AS n FROM '+table)).rows[0].n,0);
  const queued=(await db.query('SELECT payload FROM resolute.notification_outbox')).rows[0].payload;
  assert.equal(JSON.stringify(queued).includes('ownerAccess'),false);
 }finally{await db.close();}
});
test('send-time account/MFA recheck enables only owner and never overrides consent or recipient gates',async()=>{
 const clock=new Date('2026-10-31T22:00:00Z');const grant=ownerAccessFromVerifiedAccount(account,true,clock.getTime());
 const task={key:owner+':2026-11-01:alerts',kind:'alerts',deliveryDateJst:'2026-11-01',settingsRevision:1,ruleKey:'rule',acceptedAt:null};
 const context={userId:owner,ownerAccess:grant,settings:{...defaultNotificationSettings(),alertsEnabled:true,watchItems:[{symbol:'AAA',referencePrice:100}]},revision:1,ruleKey:'rule',entitlements:[],recipientVerified:true,preferencesConfigured:true,unsubscribed:false,planExists:true};
 let sent=0;
 const run=c=>dispatchNotification(task,{deliveryEnabled:true,now:()=>clock,read:async()=>c,claimAlert:async()=>true,send:async()=>{sent++;return 'accepted';},acknowledge:async()=>{}});
 assert.equal(await run(context),'accepted');
 for(const patch of [{ownerAccess:undefined},{ownerAccess:{...grant}},{userId:'user_other'},{unsubscribed:true},{recipientVerified:false},{preferencesConfigured:false},{settings:{...context.settings,alertsEnabled:false}}])assert.equal(await run({...context,...patch}),'suppressed');
 assert.equal(sent,1);
 let current={...account,primaryEmailAddressId:'email',emailAddresses:[{id:'email',emailAddress:'owner@example.test',verification:{status:'verified'}}]};
 const recipient=createClerkNotificationRecipient({users:{getUser:async()=>current}},true);
 assert.equal(hasOwnerAccess((await recipient(owner)).ownerAccess,owner),true);
 current={...current,twoFactorEnabled:false};assert.equal((await recipient(owner)).ownerAccess,undefined);
 current={...current,twoFactorEnabled:true,banned:true};assert.equal((await recipient(owner)).ownerAccess,undefined);
});
