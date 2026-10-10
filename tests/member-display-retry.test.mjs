import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const compiled=ts.transpileModule(readFileSync(new URL('../app/research/member-display-provider.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
async function harness(t, results) {
 const states=[],timers=[],events=new Map();let effect,calls=0;
 t.mock.method(globalThis,'setTimeout',(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;});
 t.mock.method(globalThis,'clearTimeout',timer=>{if(timer)timer.cancelled=true;});
 t.mock.method(globalThis,'setInterval',()=>0);t.mock.method(globalThis,'clearInterval',()=>{});
 const previousWindow=globalThis.window,previousDocument=globalThis.document;
 globalThis.window={addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)};
 globalThis.document={visibilityState:'visible',...globalThis.window};

 const react={...require('react'),useState:value=>{const index=states.length;states.push(value);return [value,next=>{states[index]=next;}];},useEffect:fn=>{effect=fn;}};
 const mod={exports:{}};
 new Function('require','module','exports',compiled)(id=>{
  if(id==='react')return react;
  if(id==='./identity-provider')return {useIdentityRefresh:()=>async()=>{}};
  if(id==='@/lib/research/member-recovery')return {recoverMember:async()=>{const result=results[Math.min(calls++,results.length-1)];if(result instanceof Error)throw result;return result;}};
  return require(id);
 },mod,mod.exports);
 mod.exports.MemberDisplayProvider({children:null});const cleanup=effect();t.after(()=>{cleanup();globalThis.window=previousWindow;globalThis.document=previousDocument;});
 const flush=async()=>{await Promise.resolve();await Promise.resolve();};await flush();
 return {states,timers,events,flush,calls:()=>calls};
}
const member=plan=>({response:{ok:true},member:{status:'signed-in',plan,accessExpiresAt:Date.now()+60_000,isAdmin:false}});
test('temporary failure remains unverified and retries after two seconds to recover PRO',async t=>{
 const h=await harness(t,[new Error('offline'),member('pro')]);assert.equal(h.states[0],null);
 const retry=h.timers.find(x=>x.ms===2000&&!x.cancelled);assert.ok(retry);retry.fn();await h.flush();
 assert.equal(h.states[0],'pro');assert.equal(h.calls(),2);
});
test('confirmed FREE remains locked; online recheck never invents a PRO entitlement',async t=>{
 const h=await harness(t,[member('free')]);assert.equal(h.states[0],'free');h.events.get('online')();await h.flush();assert.equal(h.states[0],'free');assert.equal(h.states[1],false);
});
test('persistent outage stops rapid retries after three attempts',async t=>{
 const h=await harness(t,[new Error('offline')]);
 for(let i=0;i<3;i++){const timer=h.timers.find(x=>!x.cancelled&&!x.ran&&x.ms===2000);assert.ok(timer);timer.ran=true;timer.fn();await h.flush();}
 assert.equal(h.calls(),4);assert.equal(h.timers.filter(x=>!x.cancelled&&!x.ran&&x.ms===2000).length,0);assert.equal(h.states[0],null);
});
