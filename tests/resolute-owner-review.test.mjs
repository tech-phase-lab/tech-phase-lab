import test from 'node:test';
import assert from 'node:assert/strict';
import { canReviewResolute } from '../lib/resolute/review-policy.ts';
import { OWNER_ACCOUNT_ID } from '../lib/membership/entitlements.ts';
import { createReviewStore } from '../lib/resolute/review-store.ts';
import { parsePlanSnapshot } from '../lib/resolute/plan-data.ts';

test('only the exact owner on preview may review; roles and production never qualify', () => {
 assert.equal(canReviewResolute(OWNER_ACCOUNT_ID,'preview'),true);
 for(const id of [null,undefined,'user_other','admin','pro']) assert.equal(canReviewResolute(id,'preview'),false);
 for(const env of [undefined,'production','development']) assert.equal(canReviewResolute(OWNER_ACCOUNT_ID,env),false);
});
test('review plans validate, save with revisions, and never share data between workspaces',async()=>{
 const a=createReviewStore(),b=createReviewStore();
 const original=parsePlanSnapshot(await a.requestPlan());
 assert.equal(original.plan.toleranceDrop,600000);
 const {createdAt,updatedAt,...input}=original.plan;
 assert.equal(createdAt,updatedAt);
 input.noBuyConditions=['sample condition'];
 const saved=await a.requestPlan({plan:input,baseRevision:original.revision});
 assert.equal(saved.revision,2);
 assert.deepEqual(saved.plan.noBuyConditions,['sample condition']);
 await assert.rejects(a.requestPlan({plan:input,baseRevision:1}),e=>e.kind==='conflict'&&e.snapshot.revision===2);
 saved.plan.noBuyConditions.push('external mutation');
 assert.deepEqual((await a.requestPlan()).plan.noBuyConditions,['sample condition']);
 assert.notDeepEqual((await b.requestPlan()).plan.noBuyConditions,['sample condition']);
 await assert.rejects(a.requestPlan({plan:{...input,investable:1},baseRevision:2}),e=>e.kind==='invalid');
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
