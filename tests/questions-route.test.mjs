import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const memberSource = readFileSync(new URL('../app/api/research/questions/route.ts', import.meta.url), 'utf8')
  .replace('import { getMembership } from "@/lib/membership/server";', 'const getMembership = async () => globalThis.__questions.member;');
const adminSource = readFileSync(new URL('../app/api/research/questions/moderation/route.ts', import.meta.url), 'utf8')
  .replace('import { getMembership } from "@/lib/membership/server";', 'const getMembership = async () => globalThis.__questions.member;');

test('member question route requires identity, hashes ownership and keeps retries idempotent', async () => {
  const saved={fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
  const state=globalThis.__questions={member:{status:'signed-out'},calls:[]};
  process.env.RESEARCH_MONITOR_URL='https://monitor.example';process.env.RESEARCH_MONITOR_TOKEN='monitor-token-at-least-24-characters';
  globalThis.fetch=async(url,init)=>{state.calls.push({url:String(url),init});return Response.json({ok:true,audience:"pro-board",items:[],item:{id:'q-'+'1'.repeat(32)}});};
  try {
    const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(memberSource)).toString('base64'));
    assert.equal((await GET()).status,401);assert.equal(state.calls.length,0);
    state.member={status:'signed-in',userId:'user_private_123',plan:'free'};
    assert.equal((await GET()).status,403);assert.equal(state.calls.length,0);
    const freeRequest=new Request('https://example.test/api/research/questions',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({audience:'pro-board',requestId:'q-'+'1'.repeat(32),body:'質問の投稿権限を確認します。'})});
    assert.equal((await POST(freeRequest)).status,403);assert.equal(state.calls.length,0);
    state.member.plan='pro';
    assert.equal((await GET()).status,200);
    assert.match(state.calls[0].init.headers['X-Question-Owner'],/^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(state.calls),/user_private_123/);
    const body=JSON.stringify({audience:'pro-board',requestId:'q-'+'1'.repeat(32),body:'決算で最初に見る数字は何ですか？'});
    assert.equal((await POST(new Request('https://example.test/api/research/questions',{method:'POST',headers:{origin:'https://attacker.test','content-type':'application/json'},body}))).status,403);
    assert.equal((await POST(new Request('https://example.test/api/research/questions',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body}))).status,200);
    const sent=JSON.parse(state.calls.at(-1).init.body);assert.match(sent.ownerKey,/^[a-f0-9]{64}$/);assert.equal(sent.body,'決算で最初に見る数字は何ですか？');
  } finally {globalThis.fetch=saved.fetch;delete globalThis.__questions;for(const [key,value] of [['RESEARCH_MONITOR_URL',saved.url],['RESEARCH_MONITOR_TOKEN',saved.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('moderation route is owner-only and uses the server editor credential', async () => {
  const saved={fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_EDITOR_TOKEN};
  const state=globalThis.__questions={member:{status:'signed-in',isAdmin:false},calls:[]};
  process.env.RESEARCH_MONITOR_URL='https://monitor.example';process.env.RESEARCH_EDITOR_TOKEN='editor-token-at-least-24-characters';
  globalThis.fetch=async(url,init)=>{state.calls.push({url:String(url),init});return Response.json({ok:true,items:[],answers:[],counts:{pending:0,answered:0,closed:0}});};
  try {
    const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(adminSource)).toString('base64'));
    assert.equal((await GET(new Request('https://example.test/api/research/questions/moderation'))).status,403);assert.equal(state.calls.length,0);
    state.member={status:'signed-in',isAdmin:true,userId:'owner'};
    assert.equal((await GET(new Request('https://example.test/api/research/questions/moderation?view=pending'))).status,200);
    assert.equal(new URL(state.calls[0].url).pathname,'/admin/questions');assert.equal(state.calls[0].init.headers.Authorization,'Bearer editor-token-at-least-24-characters');
    const body=JSON.stringify({id:'q-'+'1'.repeat(32),decision:'closed'});
    assert.equal((await POST(new Request('https://example.test/api/research/questions/moderation',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body}))).status,200);
    assert.equal(new URL(state.calls.at(-1).url).pathname,'/admin/questions/review');
  } finally {globalThis.fetch=saved.fetch;delete globalThis.__questions;for(const [key,value] of [['RESEARCH_MONITOR_URL',saved.url],['RESEARCH_EDITOR_TOKEN',saved.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('question pages separate private intake, moderation and published answers',()=>{
  const intake=readFileSync(new URL('../app/research/qa/questions.tsx',import.meta.url),'utf8');
  const moderation=readFileSync(new URL('../app/research/questions/moderation.tsx',import.meta.url),'utf8');
  assert.match(intake,/PRO会員に公開して投稿/);assert.match(intake,/すべての質問への回答はお約束していません/);
  assert.match(moderation,/本文をそのまま公開せず/);assert.match(moderation,/公開済みQ&A/);
  assert.match(readFileSync(new URL('../app/research/qa/answered/page.tsx',import.meta.url),'utf8'),/initialKind="qa"/);
});
