import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('price target GET starts even when IntersectionObserver never reports a visible panel',()=>{
 const source=read('app/research/price-targets-panel.tsx').replace(/^import .*;\n/gm,'').replace('export default function','function').replace(/  const t = \(ja:[\s\S]*$/, '  return null;\n}');
 const requests=[];let cleanup;
 const run=new Function('useRef','useState','useEffect','useCalendarClock','createSnapshotRevisionGuard','IntersectionObserver','document','observePageActivity','fetch',stripTypeScriptTypes(source)+'; PriceTargetsPanel({lang:"ja"});');
 run(()=>({current:{}}),v=>[typeof v==='function'?v():v,()=>{}],fn=>{cleanup=fn();},()=>0,()=>({beginFallback:()=>()=>true}),class{observe(){}disconnect(){}},{hidden:false,addEventListener(){},removeEventListener(){}},()=>()=>{},(url,options)=>{requests.push({url,options});return new Promise(()=>{});});
 assert.deepEqual(requests.map(r=>r.url),['/api/research/price-targets']);
 cleanup();assert.equal(requests[0].options.signal.aborted,true);
});
test('the streamed home data includes the already fetched news snapshot',()=>{
 assert.match(read('app/research/page.tsx'),/news={live.news}/);
 assert.match(read('app/research/home-dashboard.tsx'),/initialNews={live.news}/);
});
