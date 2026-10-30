import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';
import {OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID, isOwnerAccount, productionOwnerMode} from '../lib/membership/entitlements.ts';

test('production owner access is exact, environment restricted and MFA gated',()=>{
 assert.equal(isOwnerAccount(OWNER_ACCOUNT_ID),true);
 assert.equal(isOwnerAccount(PRODUCTION_OWNER_ACCOUNT_ID),true);
 for(const id of ['', 'user_other', PRODUCTION_OWNER_ACCOUNT_ID+'x', PRODUCTION_OWNER_ACCOUNT_ID.toLowerCase()])assert.equal(isOwnerAccount(id),false);
 assert.equal(productionOwnerMode(PRODUCTION_OWNER_ACCOUNT_ID,true,'production'),true);
 assert.equal(productionOwnerMode(PRODUCTION_OWNER_ACCOUNT_ID,false,'production'),false);
 for(const env of [undefined,'preview','development'])assert.equal(productionOwnerMode(PRODUCTION_OWNER_ACCOUNT_ID,true,env),false);
 for(const id of [OWNER_ACCOUNT_ID,'user_other',''])assert.equal(productionOwnerMode(id,true,'production'),false);
});

test('production owner gets operational PRO without buying; ordinary accounts still use live billing',async()=>{
 let source=readFileSync(new URL('../lib/membership/server.ts',import.meta.url),'utf8')
  .replace('import "server-only";','')
  .replace('import {liveMembership} from "@/services/tech-phase-billing/live-membership.mjs";','const liveMembership=async()=>{globalThis.__productionOwner.calls++;return globalThis.__productionOwner.live;};')
  .replace('import { cache } from "react";','const cache=fn=>fn;')
  .replace('import { auth, clerkClient } from "@clerk/nextjs/server";','const auth=async()=>globalThis.__productionOwner.session;const clerkClient=async()=>({users:{getUser:async()=>globalThis.__productionOwner.user}});');
 for(const name of ['entitlements','admin-mfa'])source=source.replace(`"./${name}"`,JSON.stringify(new URL(`../lib/membership/${name}.ts`,import.meta.url).href));
 const {code}=await transform(source,{loader:'ts',format:'esm'});
 const {getMembership}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const keys=['CLERK_SECRET_KEY','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','TECH_PHASE_REQUIRE_ADMIN_MFA','VERCEL_ENV'];
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try {
  Object.assign(process.env,{CLERK_SECRET_KEY:'fixture',NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:'fixture',TECH_PHASE_REQUIRE_ADMIN_MFA:'true',VERCEL_ENV:'production'});
  const state=globalThis.__productionOwner={calls:0,live:{plan:'free',accessExpiresAt:0},session:{userId:PRODUCTION_OWNER_ACCOUNT_ID,sessionClaims:{fva:[0,0]}},user:{twoFactorEnabled:true,privateMetadata:{}}};
  let member=await getMembership();
  assert.equal(member.plan,'pro');assert.equal(member.isAdmin,true);assert.equal(member.ownerMode,true);assert.equal(member.ownerAccount,true);assert.equal(member.canTest,false);assert.equal(member.testing,false);assert.ok(member.accessExpiresAt>Date.now());assert.equal(state.calls,0);
  for (const plan of ['free','pro']) {
   state.user.privateMetadata={membershipPreview:{plan,proExpiresAt:new Date(Date.now()+3600000).toISOString(),testUntil:new Date(Date.now()+3600000).toISOString()}};
   member=await getMembership();assert.equal(member.plan,plan);assert.equal(member.ownerMode,false);assert.equal(member.ownerAccount,false);assert.equal(member.testing,true);assert.equal(member.isAdmin,true);assert.equal(state.calls,0);
  }
  state.user.privateMetadata={membershipPreview:null};member=await getMembership();assert.equal(member.ownerAccount,true);assert.equal(member.ownerMode,true);assert.equal(member.testing,false);
  state.session.sessionClaims={fva:[0,-1]};member=await getMembership();
  assert.equal(member.plan,'free');assert.equal(member.isAdmin,false);assert.equal(member.ownerMode,false);assert.equal(member.adminMfaRequired,true);assert.equal(state.calls,1);
  state.session={userId:'user_other',sessionClaims:{fva:[0,0]}};state.user.privateMetadata={role:'admin',plan:'pro',proExpiresAt:'2099-01-01'};
  member=await getMembership();assert.equal(member.plan,'free');assert.equal(member.ownerMode,false);assert.equal(member.ownerAccount,false);assert.equal(state.calls,2);
  state.live={plan:'pro',accessExpiresAt:Date.now()+600000};member=await getMembership();assert.equal(member.plan,'pro');assert.equal(member.accessExpiresAt,state.live.accessExpiresAt);assert.equal(state.calls,3);
 } finally {
  for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}
  delete globalThis.__productionOwner;
 }
});
