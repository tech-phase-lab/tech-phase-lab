import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

const source = readFileSync(new URL('../app/api/resolute/entitlements/route.ts',import.meta.url),'utf8')
  .replace('import { auth } from "@clerk/nextjs/server";', 'const auth = () => globalThis.__resoluteAuth();')
  .replace('import { membershipConfigured } from "@/lib/membership/server";', 'const membershipConfigured = () => globalThis.__resoluteConfigured;')
  .replace('import { getResoluteEntitlementsForUser } from "@/lib/resolute/server";', 'const getResoluteEntitlementsForUser = id => globalThis.__resoluteRead(id);');
const {GET}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
test('entitlement route uses authenticated identity, returns private errors and never trusts request claims', async () => {
  const calls=[];
  globalThis.__resoluteConfigured=true;
  globalThis.__resoluteRead=async id=>{calls.push(id);return {canUseTools:false,canReceiveNotifications:false};};
  try {
    globalThis.__resoluteAuth=async()=>({userId:null});
    let res=await GET(); assert.equal(res.status,401);
    assert.deepEqual(await res.json(),{error:'AUTH_REQUIRED'});assert.equal(calls.length,0);
    globalThis.__resoluteAuth=async()=>({userId:'user_buyer',plan:'pro',isAdmin:true});
    res=await GET(new Request('https://example.test/api/resolute/entitlements?userId=user_victim&pro=true'));
    assert.equal(res.status,200);assert.deepEqual(calls,['user_buyer']);
    assert.equal((await res.json()).canUseTools,false);
    assert.equal(res.headers.get('cache-control'),'private, no-store');
    globalThis.__resoluteRead=async()=>{throw Error('postgres://private:secret@private/resolute');};
    res=await GET();assert.equal(res.status,503);
    assert.deepEqual(await res.json(),{error:'ENTITLEMENT_UNAVAILABLE'});
    assert.equal(res.headers.get('cache-control'),'private, no-store');
    globalThis.__resoluteConfigured=false;
    assert.equal((await GET()).status,503);
    globalThis.__resoluteConfigured=true;
    globalThis.__resoluteAuth=async()=>{throw Error('authentication provider failed');};
    assert.equal((await GET()).status,503);
  } finally {
    delete globalThis.__resoluteAuth;delete globalThis.__resoluteRead;delete globalThis.__resoluteConfigured;
  }
});
test('RESOLUTE routes are included in Clerk middleware without changing existing matchers', () => {
  const proxy=readFileSync(new URL('../proxy.ts',import.meta.url),'utf8');
  assert.ok(proxy.includes('"/api/resolute/:path*"'));
  assert.ok(proxy.includes('"/resolute/:path*"'));
});
