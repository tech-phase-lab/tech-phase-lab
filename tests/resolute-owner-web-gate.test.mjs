import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {PRODUCTION_OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';
let source=readFileSync(new URL('../lib/resolute/server.ts',import.meta.url),'utf8')
 .replace('import "server-only";','')
 .replace("import {auth,clerkClient} from '@clerk/nextjs/server';",'const auth=()=>globalThis.__ownerSession;const clerkClient=async()=>({users:{getUser:async()=>globalThis.__ownerAccount}});')
 .replace('import { fetchResoluteEntitlements } from "./transport";','const fetchResoluteEntitlements=(...args)=>globalThis.__ownerForward(...args);');
for(const [relative,path] of [['../membership/entitlements','../lib/membership/entitlements.ts'],['./owner-free-preview','../lib/resolute/owner-free-preview.ts'],['./entitlements','../lib/resolute/entitlements.ts']])
 source=source.replace(`from '${relative}'`,`from ${JSON.stringify(new URL(path,import.meta.url).href)}`);
const {getResoluteEntitlementsForSession:read}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
test('Web FREE preview removes access without forwarding; owner and ordinary buyers retain upstream authentication',async()=>{
 const previous=process.env.VERCEL_ENV;process.env.VERCEL_ENV='production';let calls=0;
 globalThis.__ownerForward=async()=>{calls++;return {canUseTools:true};};
 globalThis.__ownerSession={userId:PRODUCTION_OWNER_ACCOUNT_ID};
 globalThis.__ownerAccount={privateMetadata:{membershipPreview:{plan:'free',testUntil:new Date(Date.now()+60000).toISOString()}}};
 try{
  assert.equal((await read('verified-token')).canUseTools,false);assert.equal(calls,0);
  globalThis.__ownerAccount={privateMetadata:{}};
  assert.equal((await read('verified-token')).canUseTools,true);assert.equal(calls,1);
  globalThis.__ownerSession={userId:'user_buyer'};
  assert.equal((await read('verified-token')).canUseTools,true);assert.equal(calls,2);
  globalThis.__ownerForward=async()=>{throw Error('upstream denied');};
  await assert.rejects(read('verified-token'),/upstream denied/);
 }finally{
  if(previous===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=previous;
  delete globalThis.__ownerSession;delete globalThis.__ownerAccount;delete globalThis.__ownerForward;
 }
});
