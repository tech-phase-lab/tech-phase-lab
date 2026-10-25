import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = readFileSync(new URL('../app/api/research/desk-post/route.ts', import.meta.url), 'utf8')
.replace('import { getMembership } from "@/lib/membership/server";', 'const getMembership = async () => globalThis.__desk.member;')
.replace('import { POST as editPost } from "../editor/route";', 'const editPost = async request => {globalThis.__desk.calls.push(await request.json());return Response.json({ok:true,item:{version:3}});};');
test('inline edit/delete requires owner, origin and version, and never relays a browser reviewer or weekly mutation', async () => {
 const previous = process.env.RESEARCH_EDITOR_TOKEN;
 const state = globalThis.__desk = {member:{status:'signed-out'},calls:[]};
 const {POST} = await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
 const request = (input={},origin='https://example.com') => new Request('https://example.com/api/research/desk-post',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({id:'synthetic-note-0001',kind:'notes',version:2,action:'edit',bodyJa:'**訂正**',...input})});
 try {
  process.env.RESEARCH_EDITOR_TOKEN='synthetic-editor-key-long-enough';
  for (const member of [{status:'signed-out',isAdmin:true},{status:'signed-in',isAdmin:false,plan:'pro'}]) {state.member=member;assert.equal((await POST(request())).status,403);}
  state.member={status:'signed-in',isAdmin:true,userId:'verified-owner'};
  assert.equal((await POST(request({},'https://attacker.test'))).status,403);
  for (const input of [{kind:'weekly'},{version:0},{version:true},{action:'publish'},{bodyJa:''}]) assert.equal((await POST(request(input))).status,400);
  assert.equal(state.calls.length,0);
  assert.equal((await POST(request({reviewer:'attacker'}))).status,200);
  assert.equal(state.calls[0].payload.decision,'corrected');assert.equal(state.calls[0].payload.reviewer,'verified-owner');
  assert.equal((await POST(request({action:'delete',kind:'qa'}))).status,200);
  assert.equal(state.calls[1].payload.decision,'withdrawn');assert.equal(state.calls[1].payload.bodyJa,undefined);
 } finally { if(previous===undefined)delete process.env.RESEARCH_EDITOR_TOKEN;else process.env.RESEARCH_EDITOR_TOKEN=previous;delete globalThis.__desk; }
});
