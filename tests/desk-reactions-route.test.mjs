import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source=readFileSync(new URL('../app/api/research/desk-reactions/route.ts',import.meta.url),'utf8').replace('import { getMembership } from "@/lib/membership/server";','const getMembership=async()=>globalThis.__reactionMember;');
test('reactions require PRO, reject cross-origin writes and derive actor from session',async()=>{
 const saved={fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
 process.env.RESEARCH_MONITOR_URL='https://monitor.example';process.env.RESEARCH_MONITOR_TOKEN='test-token-at-least-24-characters';
 const calls=[];globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});return Response.json({ok:true,reactions:{like:{count:1,selected:true}}});};
 const url='https://example.test/api/research/desk-reactions?postId=note-reaction-test';
 const request=(body,origin='https://example.test')=>new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
  globalThis.__reactionMember={status:'signed-out'};assert.equal((await GET(new Request(url))).status,401);
  globalThis.__reactionMember={status:'signed-in',plan:'free',userId:'private-user'};assert.equal((await GET(new Request(url))).status,403);assert.equal(calls.length,0);
  globalThis.__reactionMember.plan='pro';assert.equal((await GET(new Request(url))).status,200);
  assert.match(calls[0].init.headers['X-Reaction-Owner'],/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(calls),/private-user/);
  const payload={postId:'note-reaction-test',emoji:'like',selected:true,ownerKey:'forged'};
  assert.equal((await POST(request(payload,'https://evil.example'))).status,403);
  assert.equal((await POST(request({...payload,selected:1}))).status,400);
  assert.equal((await POST(request({...payload,emoji:'wrong'}))).status,400);
  assert.equal((await POST(request(payload))).status,200);assert.equal(JSON.parse(calls.at(-1).init.body).ownerKey,undefined);
  for (const emoji of ['sad','angry']) assert.equal((await POST(request({...payload,emoji}))).status,200);
  globalThis.__reactionMember={status:'signed-in',plan:'pro',ownerMode:true,isAdmin:true,userId:'owner'};assert.equal((await POST(request(payload))).status,200);
 }finally{globalThis.fetch=saved.fetch;delete globalThis.__reactionMember;for(const [key,value]of[['RESEARCH_MONITOR_URL',saved.url],['RESEARCH_MONITOR_TOKEN',saved.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('Clerk middleware covers both inline post editing and reactions',()=>{
 const proxy=readFileSync(new URL('../proxy.ts',import.meta.url),'utf8');
 assert.match(proxy,/"\/api\/research\/desk-post"/);
 assert.match(proxy,/"\/api\/research\/desk-reactions"/);
});
