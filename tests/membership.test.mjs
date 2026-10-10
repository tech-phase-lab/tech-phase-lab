import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePlan} from '../lib/membership/entitlements.ts';
test('PRO requires an explicit server-managed plan and future expiry',()=>{
 const now=Date.parse('2026-09-27T00:00:00Z');
 for(const metadata of [{},{plan:'pro'},{plan:'pro',proExpiresAt:'invalid'},{plan:'pro',proExpiresAt:'2026-09-26'},{plan:'free',proExpiresAt:'2027-01-01'}]) assert.equal(resolvePlan(metadata,now),'free');
 assert.equal(resolvePlan({plan:'pro',proExpiresAt:'2027-01-01'},now),'pro');
 assert.equal(resolvePlan({plan:'pro',proExpiresAt:'2026-09-27T00:00:00Z'},now),'free');
});

import {csvCell, memberCsv} from '../lib/membership/csv.ts';
test('member exports escape CSV and neutralize spreadsheet formulas',()=>{
 assert.equal(csvCell('A,"B"'), '"A,""B"""');
 for(const value of ['=1+1',' +SUM(A1)','\t@IMPORT','-1']) assert.ok(csvCell(value).startsWith('"\''));
 assert.equal(memberCsv([['名前','プラン']]), '\uFEFF"名前","プラン"');
});

import {resolveAdmin} from '../lib/membership/entitlements.ts';
test('only the designated owner or server-granted admins can export members',()=>{
 const owner='user_3JulL4D07KtVl5Eg2zdY1iczKbC';
 assert.equal(resolveAdmin(owner,{example:'data'}),true);
 for(const id of [null,undefined,'',owner+'x',owner.toLowerCase(),'user_other']) {
  assert.equal(resolveAdmin(id,{}),false);
 }
 assert.equal(resolveAdmin(null,{role:'admin'}),false);
 assert.equal(resolveAdmin('user_other',{role:'admin'}),true);
 assert.equal(resolveAdmin('user_other',{plan:'pro',role:'Admin'}),false);
 assert.equal(resolvePlan({example:'data'}),'free');
});

import {validSyncToken} from '../lib/membership/sync-auth.ts';
test('sheet sync rejects missing, weak and incorrect credentials',()=>{
 const secret='a'.repeat(48);
 assert.equal(validSyncToken('Bearer '+secret,secret),true);
 for(const header of [null,'','Bearer wrong','Basic '+secret,'Bearer '+secret+'x']) assert.equal(validSyncToken(header,secret),false);
 assert.equal(validSyncToken('Bearer short','short'),false);
 assert.equal(validSyncToken('Bearer '+secret,undefined),false);
});

import {previewPlan} from '../lib/membership/entitlements.ts';
import {ownerPreviewMode} from '../lib/membership/entitlements.ts';
test('owner preview default requires verified admin and respects active reader previews',()=>{
 const now=Date.parse('2026-09-30T00:00:00Z');
 assert.equal(ownerPreviewMode({},true,'preview',now),true);
 assert.equal(ownerPreviewMode({},false,'preview',now),false);
 for(const env of ['production','development',undefined]) assert.equal(ownerPreviewMode({},true,env,now),false);
 for(const plan of ['free','pro']) assert.equal(ownerPreviewMode({membershipPreview:{plan,proExpiresAt:'2026-09-30T01:00:00Z',testUntil:'2026-09-30T01:00:00Z'}},true,'preview',now),false);
 assert.equal(ownerPreviewMode({membershipPreview:{plan:'free',testUntil:'2026-09-29T00:00:00Z'}},true,'preview',now),true);
});
test('preview overrides cannot grant production or non-admin access and expire closed',()=>{
 const now=Date.parse('2026-09-28T00:00:00Z');
 const meta={membershipPreview:{plan:'pro',proExpiresAt:'2026-09-28T00:01:00Z',testUntil:'2026-09-28T01:00:00Z'}};
 assert.equal(previewPlan(meta,true,'preview',now),'pro');
 assert.equal(previewPlan(meta,true,'preview',now+60_000),'free');
 assert.equal(previewPlan(meta,true,'preview',now+3_600_000),null);
 for(const environment of ['production','development',undefined]) assert.equal(previewPlan(meta,true,environment,now),null);
 assert.equal(previewPlan(meta,false,'preview',now),null);
 assert.equal(previewPlan({membershipPreview:{plan:'pro'}},true,'preview',now),null);
 assert.equal(previewPlan({membershipPreview:null},true,'preview',now),null);
});
