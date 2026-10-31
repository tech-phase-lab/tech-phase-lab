import test from 'node:test';
import assert from 'node:assert/strict';
import {isOwnerFreePreview} from '../lib/resolute/owner-free-preview.ts';
import {PRODUCTION_OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';
import {fetchResoluteEntitlements,ResoluteOwnerMfaRequired,validateSnapshot} from '../lib/resolute/transport.ts';
import {resolveResoluteEntitlements} from '../lib/resolute/entitlements.ts';

test('only approved production owner with an unexpired private FREE preview receives the LP decision',()=>{
 const now=Date.now(),metadata={membershipPreview:{plan:'free',testUntil:new Date(now+60000).toISOString()}};
 assert.equal(isOwnerFreePreview(PRODUCTION_OWNER_ACCOUNT_ID,metadata,'production',now),true);
 assert.equal(isOwnerFreePreview('user_other',metadata,'production',now),false);
 assert.equal(isOwnerFreePreview(PRODUCTION_OWNER_ACCOUNT_ID,metadata,'preview',now),false);
 assert.equal(isOwnerFreePreview(PRODUCTION_OWNER_ACCOUNT_ID,metadata,'production',now+60001),false);
 assert.equal(isOwnerFreePreview(PRODUCTION_OWNER_ACCOUNT_ID,{},'production',now),false);
 const pro={membershipPreview:{plan:'pro',testUntil:new Date(now+60000).toISOString(),proExpiresAt:new Date(now+60000).toISOString()}};
 assert.equal(isOwnerFreePreview(PRODUCTION_OWNER_ACCOUNT_ID,pro,'production',now),false);
 const view=validateSnapshot(resolveResoluteEntitlements([],new Date(now).toISOString()));
 assert.equal(view.canUseTools,false); assert.equal(view.canReceiveNotifications,false);
});
test('upstream owner MFA denial is distinct from invalid success response and does not retry',async()=>{
 let calls=0;
 const req=async()=>{calls++;return Response.json({error:'OWNER_MFA_REQUIRED'},{status:403});};
 await assert.rejects(fetchResoluteEntitlements('session','https://example.up.railway.app','x'.repeat(64),req),ResoluteOwnerMfaRequired);
 assert.equal(calls,1);
 await assert.rejects(fetchResoluteEntitlements('session','https://example.up.railway.app','x'.repeat(64),async()=>Response.json({canUseTools:true})),/Invalid entitlement response/);
});
