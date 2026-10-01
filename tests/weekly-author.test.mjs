import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('../app/api/research/weekly-author/route.ts',import.meta.url),'utf8')
.replace('import { getMembership } from "@/lib/membership/server";','const getMembership=async()=>globalThis.__weekly.member;')
.replace('import { GET as listPosts, POST as editPost } from "../editor/route";','const listPosts=async()=>Response.json({ok:true,items:[{kind:"notes"},{kind:"weekly"}],nextOffset:20});const editPost=async r=>{globalThis.__weekly.calls.push({auth:r.headers.get("authorization"),body:await r.json()});return Response.json({ok:true,item:{id:"weekly-test",version:2}});};');
test('weekly editing requires server owner identity and verified publication',async()=>{
 const previous=process.env.RESEARCH_EDITOR_TOKEN,state=globalThis.__weekly={member:{},calls:[]};
 const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
 const request=(verified=true,origin='https://example.com')=>new Request('https://example.com/api/research/weekly-author',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action:'publish',bodyJa:'本文',kind:'notes',reviewer:'attacker',verified})});
 try{
 process.env.RESEARCH_EDITOR_TOKEN='synthetic-weekly-key-long-enough';
 for(const member of [{status:'signed-out',isAdmin:true},{status:'signed-in',isAdmin:false,plan:'free'},{status:'signed-in',isAdmin:false,plan:'pro'}]){state.member=member;assert.equal((await GET(request())).status,403);assert.equal((await POST(request())).status,403);}
 state.member={status:'signed-in',isAdmin:true,userId:'verified-owner'};
 assert.equal((await POST(request(true,'https://attacker.example'))).status,403);
 assert.equal((await POST(request(false))).status,400);assert.equal(state.calls.length,0);
 assert.equal((await POST(request())).status,200);assert.equal(state.calls.length,2);
 for(const call of state.calls){assert.equal(call.body.payload.kind,'weekly');assert.equal(call.auth,'Bearer synthetic-weekly-key-long-enough');}
 assert.equal(state.calls[1].body.payload.reviewer,'verified-owner');
 const feed=await (await GET(request())).json();assert.deepEqual(feed.items,[{kind:'weekly'}]);assert.equal(feed.nextOffset,20);
 }finally{if(previous===undefined)delete process.env.RESEARCH_EDITOR_TOKEN;else process.env.RESEARCH_EDITOR_TOKEN=previous;delete globalThis.__weekly;}
});
test('weekly section parser preserves unstructured text and bilingual report paragraphs',async()=>{
 const code=readFileSync(new URL('../lib/research/weekly.ts',import.meta.url),'utf8');
 const {weeklySections}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(code)).toString('base64'));
 const body='## 今週\n売上 $54.23B\n\n利益率 87%\n## Next week\nCheck guidance.';
 assert.deepEqual(weeklySections(body),[{title:'今週',body:'売上 $54.23B\n\n利益率 87%'},{title:'Next week',body:'Check guidance.'}]);
 assert.deepEqual(weeklySections('Preface\n'+body),[{title:'',body:'Preface\n'+body}]);
});
