import test from 'node:test';
import assert from 'node:assert/strict';
import { canReviewResolute } from '../lib/resolute/review-policy.ts';
import { OWNER_ACCOUNT_ID } from '../lib/membership/entitlements.ts';
import { createReviewStore } from '../lib/resolute/review-store.ts';
import { requestReviewAccess } from '../lib/resolute/review-client.ts';
import { emptyDiagnosisDraft, draftToPlan } from '../lib/resolute/diagnosis-form.ts';
import { parsePlanSnapshot } from '../lib/resolute/plan-data.ts';

test('only the exact owner on preview may review; roles and production never qualify', () => {
 assert.equal(canReviewResolute(OWNER_ACCOUNT_ID,'preview'),true);
 for(const id of [null,undefined,'user_other','admin','pro']) assert.equal(canReviewResolute(id,'preview'),false);
 for(const env of [undefined,'production','development']) assert.equal(canReviewResolute(OWNER_ACCOUNT_ID,env),false);
});
test('review plans validate, save with revisions, and never share data between workspaces',async()=>{
 const a=createReviewStore(),b=createReviewStore();
 assert.deepEqual(parsePlanSnapshot(await a.requestPlan()),{plan:null,revision:0});
 const draft=emptyDiagnosisDraft();
 Object.assign(draft.answers,{q01:'first',q02:'l25',q03:'stable',q04:'m6',q05:'m6',q06:'none',q07:'input',q08:'input',q09:'y10plus',q10:'rarely',q11:'p20',q12:'no',q13:'wait',q14:'never',q15:'hold',q16:'steady',q17:'monthly',q18:'weekly',q19:'never',q20:'fund_etf',q22:'p20',q23:'none',q24:'steps3',q25:'d10',q26:'b5',q27:'equal',q28:['cash_low'],q29:['over_tolerance'],q30:'ignore'});
 draft.numbers={q07:'10000000',q08:'3000000'};
 const input=draftToPlan(draft);
 input.noBuyConditions=['sample condition'];
 const saved=await a.requestPlan({plan:input,baseRevision:0});
 assert.equal(saved.revision,1);
 assert.deepEqual(saved.plan.noBuyConditions,['sample condition']);
 await assert.rejects(a.requestPlan({plan:input,baseRevision:0}),e=>e.kind==='conflict'&&e.snapshot.revision===1);
 saved.plan.noBuyConditions.push('external mutation');
 assert.deepEqual((await a.requestPlan()).plan.noBuyConditions,['sample condition']);
 assert.equal((await b.requestPlan()).plan,null);
 await assert.rejects(a.requestPlan({plan:{...input,investable:1},baseRevision:1}),e=>e.kind==='invalid');
});
test('review settings save only in memory, remain isolated, validate and honor aborted writes',async()=>{
 const a=createReviewStore(),b=createReviewStore();
 const initial=await a.requestNotificationSettings();
 assert.equal(initial.settings.morningEnabled,false);
 const settings={...initial.settings,deliveryHourJst:10,morningEnabled:true};
 assert.equal((await a.requestNotificationSettings({settings,baseRevision:0})).revision,1);
 assert.equal((await b.requestNotificationSettings()).settings.morningEnabled,false);
 await assert.rejects(a.requestNotificationSettings({settings,baseRevision:0}),e=>e.status===409);
 await assert.rejects(a.requestNotificationSettings({settings:{...settings,deliveryHourJst:11},baseRevision:1}),e=>e.status===400);
 await assert.rejects(a.requestNotificationSettings({settings,baseRevision:1},AbortSignal.abort()));
 assert.equal((await a.requestNotificationSettings()).revision,1);
 await assert.rejects(a.requestPlan(undefined,AbortSignal.abort()));
});

test('owner access refreshes a session token before the request, independent of stale cookies',async()=>{
 const steps=[];
 const getToken=async options=>{assert.deepEqual(options,{skipCache:true});steps.push('refresh');return 'test-token';};
 const fetcher=async(path,init)=>{
  steps.push('request');assert.equal(path,'/api/resolute/review-access');
  assert.equal(init.headers.Authorization,'Bearer test-token');assert.equal(init.credentials,'same-origin');
  return Response.json({allowed:true});
 };
 assert.equal(await requestReviewAccess(getToken,undefined,fetcher),'allowed');
 assert.deepEqual(steps,['refresh','request']);
});
test('transient verification errors are not definitive denial; revoked sessions still fail closed',async()=>{
 const token=async()=> 'test-token';
 for(const status of [401,403]) assert.equal(await requestReviewAccess(token,undefined,async()=>new Response('',{status})),'denied');
 for(const status of [429,500,503]) assert.equal(await requestReviewAccess(token,undefined,async()=>new Response('',{status})),'unavailable');
 assert.equal(await requestReviewAccess(token,undefined,async()=>{throw Error('offline');}),'unavailable');
 assert.equal(await requestReviewAccess(async()=>null,undefined,async()=>assert.fail('no request without token')),'unavailable');
 assert.equal(await requestReviewAccess(token,AbortSignal.abort(),async()=>assert.fail('aborted')),'unavailable');
});

test('owner preview sample is valid and can open tools without completing the quiz',async()=>{
 const { createReviewSamplePlan } = await import('../lib/resolute/review-sample.ts');
 const store=createReviewStore();
 const saved=await store.requestPlan({plan:createReviewSamplePlan(),baseRevision:0});
 assert.equal(parsePlanSnapshot(saved).plan.tolerancePct,30);
 assert.equal(saved.plan.buyLines.length,3);
});
test('device persistence requires opt-in, restores validated plans and settings, and can be removed',async()=>{
 const { REVIEW_STORAGE_KEY } = await import('../lib/resolute/review-store.ts');
 const { createReviewSamplePlan } = await import('../lib/resolute/review-sample.ts');
 const data=new Map();
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const a=createReviewStore(storage);
 const plan=createReviewSamplePlan();
 await a.requestPlan({plan,baseRevision:0});
 assert.equal(data.size,0);
 a.setRemembered(true);
 assert.equal(a.getPersistence().remembered,true);
 await a.requestPlan({plan:{...plan,noBuyConditions:['saved personal rule']},baseRevision:1});
 const initial=await a.requestNotificationSettings();
 await a.requestNotificationSettings({settings:{...initial.settings,deliveryHourJst:9},baseRevision:0});
 const reopened=createReviewStore(storage);
 assert.equal((await reopened.requestPlan()).revision,2);
 assert.deepEqual((await reopened.requestPlan()).plan.noBuyConditions,['saved personal rule']);
 assert.equal((await reopened.requestNotificationSettings()).settings.deliveryHourJst,9);
 reopened.setRemembered(false);
 assert.equal(data.has(REVIEW_STORAGE_KEY),false);
 assert.equal((await createReviewStore(storage).requestPlan()).plan,null);
 assert.ok((await reopened.requestPlan()).plan,'removing device copy preserves current screen');
});
test('corrupt or unavailable device storage never prevents memory-only preview',async()=>{
 const bad=createReviewStore({getItem:()=>'{bad',setItem:()=>{throw Error('quota');},removeItem:()=>{throw Error('blocked');}});
 assert.equal((await bad.requestPlan()).plan,null);
 assert.equal(bad.getPersistence().error,true);
 bad.setRemembered(true);
 assert.deepEqual(bad.getPersistence(),{remembered:false,error:true});
 const missing=createReviewStore();
 missing.setRemembered(true);
 assert.equal(missing.getPersistence().remembered,false);
});
