import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { publishedPosts } from '../lib/research/editorial-posts.ts';

const source=readFileSync(new URL('../app/api/research/posts/latest-note/route.ts',import.meta.url),'utf8')
 .replace('import { publishedPosts } from "@/lib/research/editorial-posts";', 'const publishedPosts = globalThis.__latest.project;');

test('latest-note endpoint returns safe metadata and never a premium body or legacy headline',async()=>{
 const previous={fetch:globalThis.fetch,base:process.env.RESEARCH_MONITOR_URL,token:process.env.RESEARCH_MONITOR_TOKEN};
 globalThis.__latest={project:publishedPosts};
 process.env.RESEARCH_MONITOR_URL='https://monitor.example';process.env.RESEARCH_MONITOR_TOKEN='synthetic';
 const item={id:'synthetic-note-0001',version:2,kind:'notes',status:'published',titleJa:'LEGACY HEADLINE',titleEn:'LEGACY EN',introJa:'LEGACY INTRO',introEn:'',bodyJa:'PRO秘密本文',bodyEn:'Premium secret',publishedAt:'2026-09-28T12:00:00Z',updatedAt:'2026-09-28T12:00:00Z',sources:[]};
 globalThis.fetch=async()=>Response.json({ok:true,items:[item]});
 try {
  const {GET}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
  const response=await GET();const raw=await response.text();const data=JSON.parse(raw);
  assert.equal(response.status,200);assert.deepEqual(data.item,{id:item.id,publishedAt:item.publishedAt,translationStatus:'ready'});
  assert.doesNotMatch(raw,/PRO秘密本文|Premium secret|LEGACY/);
  assert.match(response.headers.get('cache-control'),/private, no-store/);
 } finally {globalThis.fetch=previous.fetch;delete globalThis.__latest;for(const [key,value] of [['RESEARCH_MONITOR_URL',previous.base],['RESEARCH_MONITOR_TOKEN',previous.token]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
