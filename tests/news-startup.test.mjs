import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source=readFileSync(new URL('../lib/research/news-startup.ts',import.meta.url),'utf8');
const {newsStartupScript,takeNewsStartup}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
test('initial HTML starts a single public news request before the UI adopts it',async()=>{
 const original=globalThis.window;globalThis.window={location:{pathname:'/research'}};let calls=0;
 try{
 const execute=()=>new Function('window','document','fetch',newsStartupScript)(window,{visibilityState:'visible'},async()=>{calls++;return {ok:true,json:async()=>({ok:true,items:[]})};});
 execute();execute();assert.equal(calls,1);
 const pending=takeNewsStartup();assert.deepEqual(await pending,{data:{ok:true,items:[]}});assert.equal(takeNewsStartup(),null);assert.equal(calls,1);
 }finally{if(original===undefined)delete globalThis.window;else globalThis.window=original;}
});
test('failed early request resolves safely for existing retry handling',async()=>{
 const window={location:{pathname:'/research'}};
 new Function('window','document','fetch',newsStartupScript)(window,{visibilityState:'visible'},async()=>{throw Error('offline');});
 assert.deepEqual(await window.__techPhaseNewsStartup.request,{error:true});
});
test('DESK stays locked unless the effective plan is PRO, including owner FREE preview',()=>{
 const source=readFileSync(new URL('../app/research/home-tools.tsx',import.meta.url),'utf8');
 assert.match(source,/const locked = plan !== "pro"/);assert.doesNotMatch(source,/!isPro/);
});
