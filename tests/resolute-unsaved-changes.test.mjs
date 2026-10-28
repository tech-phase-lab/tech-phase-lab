import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Exercise the effect against native EventTarget, including cleanup.
const compiled=await build({entryPoints:['app/resolute/use-unsaved-changes.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{
 name:'effect-harness',setup(b){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'harness'}));b.onLoad({filter:/.*/,namespace:'harness'},()=>({contents:'export const useEffect = (...args) => globalThis.__unsavedEffect(...args);'}));}
}]});
const {useUnsavedChanges}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
for(const dirty of [false,true]) test(`native refresh/close protection: dirty=${dirty}`,()=>{
 const previousWindow=globalThis.window, previousEffect=globalThis.__unsavedEffect;
 const target=new EventTarget();globalThis.window=target;let cleanup;
 globalThis.__unsavedEffect=(effect,deps)=>{assert.deepEqual(deps,[dirty]);cleanup=effect();};
 try{
  useUnsavedChanges(dirty);
  const event=new Event('beforeunload',{cancelable:true});target.dispatchEvent(event);
  assert.equal(event.defaultPrevented,dirty);
  cleanup?.();const after=new Event('beforeunload',{cancelable:true});target.dispatchEvent(after);
  assert.equal(after.defaultPrevented,false,'save/unmount removes protection');
 }finally{globalThis.window=previousWindow;globalThis.__unsavedEffect=previousEffect;}
});
test('separately mounted dirty forms do not clear each other’s protection',()=>{
 const previousWindow=globalThis.window, previousEffect=globalThis.__unsavedEffect;
 const target=new EventTarget();globalThis.window=target;const cleanups=[];
 globalThis.__unsavedEffect=effect=>cleanups.push(effect());
 try{
  useUnsavedChanges(true);useUnsavedChanges(true);cleanups[0]();
  const event=new Event('beforeunload',{cancelable:true});target.dispatchEvent(event);assert.equal(event.defaultPrevented,true);
  cleanups[1]();const after=new Event('beforeunload',{cancelable:true});target.dispatchEvent(after);assert.equal(after.defaultPrevented,false);
 }finally{globalThis.window=previousWindow;globalThis.__unsavedEffect=previousEffect;}
});
