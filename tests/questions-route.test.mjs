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
    assert.equal((await GET(new Request('https://example.test/api/research/questions?page=6'))).status,200);
    assert.equal(new URL(state.calls.at(-1).url).searchParams.get('page'),'6');
    for (const page of ['0','-1','1.5','100001','abc']) {
      const count=state.calls.length;
      assert.equal((await GET(new Request(`https://example.test/api/research/questions?page=${page}`))).status,400);
      assert.equal(state.calls.length,count);
    }
    const body=JSON.stringify({audience:'pro-board',requestId:'q-'+'1'.repeat(32),body:'決算で最初に見る数字は何ですか？'});
    assert.equal((await POST(new Request('https://example.test/api/research/questions',{method:'POST',headers:{origin:'https://attacker.test','content-type':'application/json'},body}))).status,403);
    assert.equal((await POST(new Request('https://example.test/api/research/questions',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body}))).status,200);
    state.member.ownerMode=true;
    assert.equal((await POST(new Request('https://example.test/api/research/questions',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body}))).status,403);
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
    const replyBody=JSON.stringify({id:'q-'+'1'.repeat(32),decision:'reply',body:'運営者の回答です。'});
    state.member.isAdmin=false;
    assert.equal((await POST(new Request('https://example.test/api/research/questions/moderation',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:replyBody}))).status,403);
    state.member.isAdmin=true;
    assert.equal((await POST(new Request('https://example.test/api/research/questions/moderation',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:replyBody}))).status,200);
    assert.equal(new URL(state.calls.at(-1).url).pathname,'/admin/questions/answer');
    const editRequest = (version, origin='https://example.test') => new Request('https://example.test/api/research/questions/moderation',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({id:'q-'+'1'.repeat(32),decision:'edit-reply',body:'訂正した回答です。',expectedVersion:version})});
    for (const version of [undefined, 0, -1, true, '2']) assert.equal((await POST(editRequest(version))).status,400);
    assert.equal((await POST(editRequest(2,'https://attacker.test'))).status,403);
    state.member.isAdmin=false;
    assert.equal((await POST(editRequest(2))).status,403);
    state.member.isAdmin=true;
    assert.equal((await POST(editRequest(2))).status,200);
    assert.equal(JSON.parse(state.calls.at(-1).init.body).expectedVersion,2);
    const body=JSON.stringify({id:'q-'+'1'.repeat(32),decision:'closed'});
    assert.equal((await POST(new Request('https://example.test/api/research/questions/moderation',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body}))).status,200);
    assert.equal(new URL(state.calls.at(-1).url).pathname,'/admin/questions/review');
  } finally {globalThis.fetch=saved.fetch;delete globalThis.__questions;for(const [key,value] of [['RESEARCH_MONITOR_URL',saved.url],['RESEARCH_EDITOR_TOKEN',saved.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('question pages: one list for members and the owner, no separate published-answers page',()=>{
  const intake=readFileSync(new URL('../app/research/qa/questions.tsx',import.meta.url),'utf8');
  const moderation=readFileSync(new URL('../app/research/questions/moderation.tsx',import.meta.url),'utf8');
  assert.match(intake,/すべてには答えられません/);assert.doesNotMatch(intake,/みんなの質問|公開された回答/);
  assert.match(moderation,/本文をそのまま公開せず/);assert.match(moderation,/公開済みQ&A/);
  const answered=readFileSync(new URL('../app/research/qa/answered/page.tsx',import.meta.url),'utf8');
  assert.match(answered,/redirect\(match \? `\/research\/qa#q-\$\{match\[1\]\}` : "\/research\/qa"\)/);
});

test('a member deletes only through the delete action; the owner view is asked for only by the verified owner (Nov 2)', async () => {
  const saved={fetch:globalThis.fetch,url:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
  const state=globalThis.__questions={member:{status:'signed-in',userId:'user_private_123',plan:'pro'},calls:[]};
  process.env.RESEARCH_MONITOR_URL='https://monitor.example';process.env.RESEARCH_MONITOR_TOKEN='monitor-token-at-least-24-characters';
  globalThis.fetch=async(url,init)=>{state.calls.push({url:String(url),init});return Response.json({ok:true,audience:"pro-board",items:[],item:{id:'q-'+'1'.repeat(32),deleted:true},left:1});};
  try {
    const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(memberSource)).toString('base64'));
    await GET();assert.equal(state.calls.at(-1).init.headers['X-Question-Owner-View'],'0');
    state.member={...state.member,ownerMode:true,isAdmin:false};await GET();assert.equal(state.calls.at(-1).init.headers['X-Question-Owner-View'],'0','owner mode without the admin check never gets the owner view');
    state.member={...state.member,ownerMode:true,isAdmin:true};await GET();assert.equal(state.calls.at(-1).init.headers['X-Question-Owner-View'],'1');
    state.member={status:'signed-in',userId:'user_private_123',plan:'pro'};
    const ask=body=>new Request('https://example.test/api/research/questions',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await POST(ask({action:'delete',id:'q-'+'1'.repeat(32)}))).status,200);
    const sent=JSON.parse(state.calls.at(-1).init.body);assert.equal(sent.action,'delete');assert.match(sent.ownerKey,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(sent),/user_private_123/);
    assert.equal((await POST(ask({action:'delete',id:'bad'}))).status,400);
    const count=state.calls.length;assert.equal((await POST(ask({action:'delete',id:'q-'+'1'.repeat(32)}).clone())).status,200);assert.equal(state.calls.length,count+1);
  } finally {globalThis.fetch=saved.fetch;delete globalThis.__questions;for(const [key,value] of [['RESEARCH_MONITOR_URL',saved.url],['RESEARCH_MONITOR_TOKEN',saved.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('the ask screen follows the owner spec: one list, tags, the bar with the day count, hold and release for the owner, settings in one file', () => {
  const screen=readFileSync(new URL('../app/research/qa/questions.tsx',import.meta.url),'utf8');
  for (const text of ['回答済み','受付中','保留','リゼルに質問する','今日あと','あなたの質問','リゼルの回答','表示する','回答する','回答を編集','文字から']) assert.ok(screen.includes(text), text);
  assert.match(screen,/const MIN = 10, MAX = 1200/);
  assert.doesNotMatch(screen,/DeskTextEditor|DeskBody/,'answers are plain text, no bold or marker');
  assert.match(screen,/ownerMode &&/);assert.match(screen,/\{!ownerMode && \(open/,'owners get no writing box');
  const settings=JSON.parse(readFileSync(new URL('../scripts/research/question_settings.json',import.meta.url),'utf8'));
  assert.equal(settings.dailyLimit,2);assert.deepEqual(settings.holdWords,['ドル箱','ゼウス','詐欺','情報商材']);
  const python=readFileSync(new URL('../scripts/research/questions.py',import.meta.url),'utf8');
  assert.doesNotMatch(python,/ドル箱|ゼウス|詐欺|情報商材/,'the words are not written into the code');
  assert.match(readFileSync(new URL('../app/api/research/questions/moderation/route.ts',import.meta.url),'utf8'),/"release", "delete"/);
});
