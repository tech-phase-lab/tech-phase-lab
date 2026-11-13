import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {validSyncToken} from '../lib/membership/sync-auth.ts';
const source=readFileSync(new URL('../app/api/research/notifications/entitlement/route.ts',import.meta.url),'utf8')
 .replace('import { getMembershipForUser } from "@/lib/membership/server";', 'const getMembershipForUser = async id => { globalThis.__entitlementTest.ids.push(id); if(globalThis.__entitlementTest.error) throw Error("offline"); return globalThis.__entitlementTest.member; };')
 .replace('import { isOwnerAccount } from "@/lib/membership/entitlements";', 'const isOwnerAccount = id => id === "user_3JulL4D07KtVl5Eg2zdY1iczKbC" || id === "user_3LHR1K8f8zwyDcVzMg7ud6KB9Wb";')
 .replace('import { validSyncToken } from "@/lib/membership/sync-auth";', 'const validSyncToken = globalThis.__entitlementTest.validate;');
test('delivery entitlement callback authenticates the monitor and fails closed', async()=>{
 const saved=process.env.RESEARCH_MONITOR_TOKEN;process.env.RESEARCH_MONITOR_TOKEN='s'.repeat(32);
 globalThis.__entitlementTest={validate:validSyncToken,ids:[],member:{plan:'pro',accessExpiresAt:Date.now()+60000}};
 try {
  const {GET}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
  const req=(token='',id='user_owner')=>new Request('https://example.test/api/research/notifications/entitlement?memberId='+id,{headers:{authorization:'Bearer '+token}});
  assert.equal((await GET(req())).status,401);
  assert.equal(globalThis.__entitlementTest.ids.length,0);
  assert.equal((await GET(req('s'.repeat(32),'invalid'))).status,400);
  const response=await GET(req('s'.repeat(32)));
  assert.equal(response.status,200);assert.equal((await response.json()).pro,true);
  assert.deepEqual(globalThis.__entitlementTest.ids,['user_owner']);
  globalThis.__entitlementTest.member={plan:'free',accessExpiresAt:0};
  assert.equal((await (await GET(req('s'.repeat(32)))).json()).pro,false);
  globalThis.__entitlementTest.error=true;assert.equal((await GET(req('s'.repeat(32)))).status,503);
 // The operator accounts are always PRO with a fresh one-hour access, whatever the membership lookup says or whether it is offline.
  for (const owner of ['user_3JulL4D07KtVl5Eg2zdY1iczKbC','user_3LHR1K8f8zwyDcVzMg7ud6KB9Wb']) {
   globalThis.__entitlementTest.ids.length=0;globalThis.__entitlementTest.member={plan:'free',accessExpiresAt:0};globalThis.__entitlementTest.error=true;
   const answer=await (await GET(req('s'.repeat(32),owner))).json();
   assert.equal(answer.pro,true);assert.equal(answer.owner,true);
   assert.ok(answer.accessExpiresAt>Date.now()/1000+3000&&answer.accessExpiresAt<Date.now()/1000+3700);
   assert.equal(globalThis.__entitlementTest.ids.length,0);
  }
  // anyone else is still looked up
  assert.equal((await GET(req('s'.repeat(32),'user_someone'))).status,503);
 } finally {delete globalThis.__entitlementTest;if(saved===undefined)delete process.env.RESEARCH_MONITOR_TOKEN;else process.env.RESEARCH_MONITOR_TOKEN=saved;}
});
