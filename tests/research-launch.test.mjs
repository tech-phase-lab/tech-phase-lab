import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('../app/research/launch-brand.tsx',import.meta.url),'utf8');
const executable=stripTypeScriptTypes(source.replace(/^import .*;\n/gm,'').replace('export default function','function').replace(/  return <div ref=[\s\S]*$/, '  return null;\n}\n'));
function launch({standalone=true,type='navigate',seen=false,storageFails=false}={}) {
 const element={hidden:true}, listeners=new Map(), callbacks=[];let cleanup;
 const document={visibilityState:'visible',addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)};
 const window={matchMedia:()=>({matches:standalone}),setTimeout:(fn,ms)=>{callbacks.push({fn,ms});return 1;},clearTimeout:()=>{},addEventListener:document.addEventListener,removeEventListener:document.removeEventListener};
 const storage={getItem:()=>{if(storageFails)throw Error('denied');return seen?'1':null;},setItem:()=>{seen=true;}};
 new Function('useEffect','useRef','window','document','navigator','performance','sessionStorage',executable+'; LaunchBrand();')(fn=>{cleanup=fn();},()=>({current:element}),window,document,{}, {getEntriesByType:()=>[{type}]},storage);
 return {element,document,listeners,callbacks,cleanup};
}
test('standalone launch ends within 1.2 seconds and does not depend on a request',()=>{
 const r=launch();assert.equal(r.element.hidden,false);assert.equal(r.callbacks[0].ms,1200);r.callbacks[0].fn();assert.equal(r.element.hidden,true);
 assert.doesNotMatch(source,/fetch\(|location\.reload|router\.refresh/);
});
test('ordinary browser, reload, history restore, repeat session and denied storage skip the splash',()=>{
 for(const options of [{standalone:false},{type:'reload'},{type:'back_forward'},{seen:true},{storageFails:true}]){const r=launch(options);assert.equal(r.element.hidden,true);assert.equal(r.callbacks.length,0);}
});
test('backgrounding dismisses immediately, returning cannot restart the animation',()=>{
 const r=launch();r.document.visibilityState='hidden';r.listeners.get('visibilitychange')();assert.equal(r.element.hidden,true);
 r.document.visibilityState='visible';r.listeners.get('visibilitychange')();assert.equal(r.element.hidden,true);
 r.cleanup();assert.equal(r.listeners.size,0);
});
test('public layout no longer blocks the shell on remote membership; loading shell is navigable',()=>{
 const layout=readFileSync(new URL('../app/research/layout.tsx',import.meta.url),'utf8');assert.doesNotMatch(layout,/await getMembership|async function/);assert.match(layout,/<MemberDisplayProvider>/);
 const loading=readFileSync(new URL('../app/research/loading.tsx',import.meta.url),'utf8');assert.match(loading,/role="status"/);assert.match(loading,/href="\/research\/stocks"/);
});
