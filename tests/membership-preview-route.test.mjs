import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

// Exercise the real route with identity-provider boundaries stubbed; no real users are modified.
const source=readFileSync(new URL('../app/api/research/member/preview/route.ts',import.meta.url),'utf8')
 .replace('import { clerkClient } from "@clerk/nextjs/server";', 'const clerkClient = async () => globalThis.__previewTest.client;')
 .replace('import { getMembership } from "@/lib/membership/server";', 'const getMembership = async () => globalThis.__previewTest.member;');
const {POST}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
test('preview route enforces environment, authenticated admin, same-origin and self-only bounded mutations',async()=>{
 const original=process.env.VERCEL_ENV;
 const calls=[];
 globalThis.__previewTest={member:{status:'signed-in',userId:'verified-owner',isAdmin:true},client:{users:{updateUserMetadata:async(...args)=>calls.push(args)}}};
 const req=(body={mode:'pro'},origin='https://example.test')=>new Request('https://example.test/api/research/member/preview',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try {
  process.env.VERCEL_ENV='production';
  assert.equal((await POST(req())).status,404);
  process.env.VERCEL_ENV='preview';
  assert.equal((await POST(req({},'https://attacker.test'))).status,403);
  for(const member of [{status:'signed-out'},{status:'signed-in',userId:'other',isAdmin:false,plan:'free'},{status:'signed-in',userId:'other',isAdmin:false,plan:'pro'}]) {
   globalThis.__previewTest.member=member;
   assert.equal((await POST(req({mode:'pro',userId:'verified-owner',role:'admin'}))).status,403);
   assert.equal((await POST(req({mode:'restore',isAdmin:true}))).status,403);
  }
  assert.equal(calls.length,0);
  globalThis.__previewTest.member={status:'signed-in',userId:'verified-owner',isAdmin:true};
  assert.equal((await POST(req({mode:'unknown'}))).status,400);
  assert.equal((await POST(req({mode:'pro',padding:'x'.repeat(257)}))).status,413);
  assert.equal(calls.length,0);
  const before=Date.now();
  assert.equal((await POST(req({mode:'expiring',userId:'victim',role:'admin'}))).status,200);
  const [id,metadata]=calls[0];
  assert.equal(id,'verified-owner');
  assert.deepEqual(Object.keys(metadata.privateMetadata),['membershipPreview']);
  const preview=metadata.privateMetadata.membershipPreview;
  assert.equal(preview.plan,'pro');
  assert.ok(Date.parse(preview.proExpiresAt)>=before+60_000);
  assert.ok(Date.parse(preview.proExpiresAt)<=Date.now()+60_000);
  assert.equal((await POST(req({mode:'restore'}))).status,200);
  assert.equal(calls[1][1].privateMetadata.membershipPreview,null);
 } finally {
  delete globalThis.__previewTest;
  if(original===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=original;
 }
});
