import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = readFileSync(new URL('../app/api/research/author/route.ts', import.meta.url), 'utf8')
.replace('import { getMembership } from "@/lib/membership/server";', 'const getMembership = async () => globalThis.__author.member;')
.replace('import { GET as listPosts, POST as editPost } from "../editor/route";', 'const listPosts = async () => Response.json({ok:true,items:[]}); const editPost = async request => { globalThis.__author.calls.push({auth:request.headers.get("authorization"),body:await request.json()}); return Response.json({ok:true,item:{id:"note-example",version:2}}); };');
test('owner composer enforces identity, origin and server credential; ignores client reviewer and English', async () => {
 const previous = process.env.RESEARCH_EDITOR_TOKEN;
 const state = globalThis.__author = {member:{status:'signed-out'},calls:[]};
 const {GET,POST} = await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
 const request = (origin='https://example.com') => new Request('https://example.com/api/research/author',{method:'POST',headers:{origin,'content-type':'application/json',authorization:'Bearer spoof'},body:JSON.stringify({action:'publish',id:'note-example',version:0,bodyJa:'本文',reviewer:'spoof',bodyEn:'spoof'})});
 try {
  process.env.RESEARCH_EDITOR_TOKEN='synthetic-editor-key-long-enough';
  for(const member of [{status:'signed-out',isAdmin:true},{status:'signed-in',isAdmin:false,plan:'pro'}]) {
   state.member=member; assert.equal((await GET(request())).status,403); assert.equal((await POST(request())).status,403);
  }
  state.member={status:'signed-in',isAdmin:true,userId:'owner-user'};
  assert.equal((await POST(request('https://attacker.example'))).status,403);
  assert.equal(state.calls.length,0);
  delete process.env.RESEARCH_EDITOR_TOKEN;
  assert.equal((await POST(request())).status,503);
  assert.equal(state.calls.length,0);
  process.env.RESEARCH_EDITOR_TOKEN='synthetic-editor-key-long-enough';
  assert.equal((await POST(request())).status,200);
  assert.equal(state.calls.length,2);
  assert.equal(state.calls[0].body.payload.kind,'notes');
  assert.equal(state.calls[0].body.payload.titleJa,'リゼルのひとりごと');
  assert.equal(state.calls[1].body.payload.kind,'notes');
  assert.equal(state.calls[0].body.payload.bodyEn,'');
  assert.equal(state.calls[1].body.payload.reviewer,'owner-user');
  assert.equal(state.calls[0].auth,'Bearer synthetic-editor-key-long-enough');
 } finally {if(previous===undefined)delete process.env.RESEARCH_EDITOR_TOKEN;else process.env.RESEARCH_EDITOR_TOKEN=previous;delete globalThis.__author;}
});
