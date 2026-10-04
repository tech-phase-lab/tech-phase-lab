import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('../lib/research/launch-boot.ts',import.meta.url),'utf8');
const {launchBoot}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
function launch({standalone=true,type='navigate',seen=false,storageFails=false,elapsed=100}={}) {
 const element={dataset:{}}, listeners=new Map(), callbacks=[];
 const document={visibilityState:'visible',getElementById:()=>element,addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)};
 const window={matchMedia:()=>({matches:standalone}),setTimeout:(fn,ms)=>{callbacks.push({fn,ms});return 1;},addEventListener:document.addEventListener,removeEventListener:document.removeEventListener};
 const storage={getItem:()=>{if(storageFails)throw Error('denied');return seen?'1':null;},setItem:()=>{seen=true;}};
 new Function('window','document','navigator','performance','sessionStorage',launchBoot)(window,document,{}, {getEntriesByType:()=>[{type}],now:()=>elapsed},storage);
 return {element,document,listeners,callbacks};
}
test('initial standalone HTML starts the logo without hydration and dismisses within 1.2s',()=>{
 const r=launch();assert.equal(r.element.dataset.active,'true');assert.equal(r.callbacks[0].ms,1200);r.callbacks[0].fn();assert.equal(r.element.dataset.active,undefined);assert.equal(r.listeners.size,0);
 assert.doesNotMatch(source,/fetch\(|location\.reload|router\.refresh/);
});
test('late startup, browser, reload, history, repeat session and denied storage never flash a splash',()=>{
 for(const options of [{elapsed:5000},{standalone:false},{type:'reload'},{type:'back_forward'},{seen:true},{storageFails:true}]){const r=launch(options);assert.equal(r.element.dataset.active,undefined);assert.equal(r.callbacks.length,0);}
});
test('backgrounding dismisses and removes resume listeners',()=>{
 const r=launch();r.document.visibilityState='hidden';r.listeners.get('visibilitychange')();assert.equal(r.element.dataset.active,undefined);assert.equal(r.listeners.size,0);
});
test('home is synchronous; live data streams inside a null fallback without replacing the dashboard',()=>{
 const page=readFileSync(new URL('../app/research/page.tsx',import.meta.url),'utf8');
 assert.match(page,/export default function ResearchPage/);assert.match(page,/<Suspense fallback={null}><LiveHomeData/);assert.match(page,/currentEvents.map\(publicEvent\)/);
 const layout=readFileSync(new URL('../app/research/layout.tsx',import.meta.url),'utf8');assert.doesNotMatch(layout,/await getMembership|async function/);
});
