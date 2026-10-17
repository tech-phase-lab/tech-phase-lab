import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('../app/api/research/notifications/route.ts',import.meta.url),'utf8')
 .replace('import { getMembership } from "@/lib/membership/server";', 'const getMembership = async () => globalThis.__pushMember;');
const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
test('member notification routes enforce verified identity, expiry and fixed owned-device paths',async()=>{
 const saved={fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
 process.env.RESEARCH_MONITOR_URL='https://monitor.example';process.env.RESEARCH_MONITOR_TOKEN='private';
 const calls=[];
 globalThis.fetch=async(url,options)=>{ calls.push([String(url),options.body?JSON.parse(options.body):null]);return Response.json({ok:true,enabled:true,memberAccessVersion:1,publicKey:'public',registered:true}); };
 const req=(action='register',origin='https://example.test')=>new Request('https://example.test/api/research/notifications',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action,memberId:'user_victim',accessExpiresAt:9999999999999,subscription:{endpoint:'device'}})});
 try {
  assert.equal((await POST(req('register','https://attacker.test'))).status,403);
  for(const [member,status] of [[{status:'unavailable'},503],[{status:'signed-out'},401],[{status:'signed-in',plan:'free'},403],[{status:'signed-in',plan:'pro',accessExpiresAt:0},403]]) {
   globalThis.__pushMember=member;assert.equal((await POST(req())).status,status);
  }
  assert.equal(calls.length,0);
  globalThis.__pushMember={status:'signed-in',userId:'user_owner',plan:'pro',accessExpiresAt:Date.now()+60000};
  for(const action of ['register','status','test','remove']) assert.equal((await POST(req(action))).status,200);
  assert.deepEqual(calls.map(c=>c[0]),['register','status','test','remove'].map(a=>'https://monitor.example/push/member/'+a));
  for(const [,body] of calls) { assert.equal(body.memberId,'user_owner');assert.equal(body.accessExpiresAt,globalThis.__pushMember.accessExpiresAt/1000);assert.equal('code' in body,false); }
  assert.equal((await (await GET()).json()).enabled,true);
  globalThis.__pushMember={status:'signed-in',userId:'user_owner',plan:'free',accessExpiresAt:0};
  assert.equal((await POST(req('remove'))).status,200);
  assert.equal((await (await GET()).json()).reason,'pro-required');
  globalThis.__pushMember={status:'signed-out'};
  assert.equal((await (await GET()).json()).reason,'sign-in');
 } finally {globalThis.fetch=saved.fetch;delete globalThis.__pushMember;for(const [key,value] of [['RESEARCH_MONITOR_URL',saved.url],['RESEARCH_MONITOR_TOKEN',saved.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
