import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {validSyncToken} from '../lib/membership/sync-auth.ts';
const source=readFileSync(new URL('../app/api/research/notifications/entitlement/route.ts',import.meta.url),'utf8')
 .replace('import { getMembershipForUser } from "@/lib/membership/server";', 'const getMembershipForUser = async id => { globalThis.__entitlementTest.ids.push(id); if(globalThis.__entitlementTest.error) throw Error("offline"); return globalThis.__entitlementTest.member; };')
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
 } finally {delete globalThis.__entitlementTest;if(saved===undefined)delete process.env.RESEARCH_MONITOR_TOKEN;else process.env.RESEARCH_MONITOR_TOKEN=saved;}
});
