import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { publishedPosts } from '../lib/research/editorial-posts.ts';
const item = {id:'synthetic-column-0001',version:2,kind:'weekly',status:'published',titleJa:'見出し',titleEn:'Headline',introJa:'導入',introEn:'Introduction',bodyJa:'PRO秘密本文',bodyEn:'Premium confidential body',sourceNotes:'PRIVATE owner memo',reviewer:'PRIVATE editor',futureSecret:'PRIVATE field',publishedAt:'2026-09-28T00:00:00Z',updatedAt:'2026-09-28T00:00:00Z',sources:[{title:'Source',url:'https://example.com',privateField:'PRIVATE'}]};
test('column projection strips private fields and withholds all PRO bodies from Free',()=>{
 for(const pro of [false,true]) {
  const result=publishedPosts({ok:true,items:[item,{...item,status:'draft'},{...item,status:'withdrawn'}]},pro);
  assert.equal(result.length,1);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  assert.equal(result[0].bodyEn,pro?item.bodyEn:'');assert.equal(result[0].sources.length,pro?1:0);
 }
 assert.deepEqual(publishedPosts({ok:true,items:[{...item,kind:'__proto__'},{...item,publishedAt:'invalid'}]},true),[]);
 const unsafe=publishedPosts({ok:true,items:[{...item,sources:[{title:'bad',url:'javascript:alert(1)'}]}]},true);
 assert.deepEqual(unsafe[0].sources,[]);
});
const source=readFileSync(new URL('../app/api/research/posts/route.ts',import.meta.url),'utf8')
 .replace('import { getMembership } from "@/lib/membership/server";', 'const getMembership = async () => { if(globalThis.__posts.error) throw Error("offline"); return globalThis.__posts.member; };')
 .replace('import { publishedPosts } from "@/lib/research/editorial-posts";', 'const publishedPosts = globalThis.__posts.project;');
test('actual columns route gates bodies using verified membership, expiry and private no-store responses',async()=>{
 const original={fetch:globalThis.fetch,base:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
 globalThis.__posts={project:publishedPosts};
 process.env.RESEARCH_MONITOR_URL='https://monitor.example';process.env.RESEARCH_MONITOR_TOKEN='synthetic';
 globalThis.fetch=async()=>Response.json({ok:true,items:[item]});
 try {
  const {GET}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
  for(const member of [{status:'signed-out',plan:'free'},{status:'signed-in',plan:'free'},{status:'signed-in',plan:'pro',accessExpiresAt:Date.now()-1},{status:'signed-in',plan:'pro'}]) {
   globalThis.__posts.member=member;const response=await GET();assert.equal(response.status,200);
   const data=await response.json();assert.equal(data.items[0].bodyEn,'');assert.notEqual(data.access,'pro');
   assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(response.headers.get('vary'),'Cookie');
  }
  globalThis.__posts.member={status:'signed-in',plan:'pro',accessExpiresAt:Date.now()+30000};
  const result=await (await GET()).json();assert.equal(result.items[0].bodyEn,item.bodyEn);assert.equal(result.access,'pro');assert.ok(result.validUntil<=globalThis.__posts.member.accessExpiresAt);
  process.env.RESEARCH_MONITOR_URL='https://user:password@monitor.example';
  assert.equal((await GET()).status,503);
  process.env.RESEARCH_MONITOR_URL='https://monitor.example';
  globalThis.__posts.error=true;assert.equal((await GET()).status,503);
  globalThis.__posts.error=false;globalThis.__posts.member={status:'unavailable'};assert.equal((await GET()).status,503);
  globalThis.__posts.member={status:'signed-in',plan:'pro',accessExpiresAt:Date.now()+30000};
  globalThis.fetch=async()=>{globalThis.__posts.member.accessExpiresAt=Date.now()-1;return Response.json({ok:true,items:[item]});};
  assert.equal((await (await GET()).json()).items[0].bodyEn,'');
 } finally {globalThis.fetch=original.fetch;delete globalThis.__posts;for(const [key,val] of [['RESEARCH_MONITOR_URL',original.base],['RESEARCH_MONITOR_TOKEN',original.token]]){if(val===undefined)delete process.env[key];else process.env[key]=val;}}
});
