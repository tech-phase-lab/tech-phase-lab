import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as lists from '../lib/research/favorite-lists.ts';
import * as freshness from '../lib/research/watchlist-freshness.ts';
import * as alerts from '../lib/research/price-alert-settings.ts';
const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL('../app/research/watchlist/watchlist.tsx', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function harness(lang='ja', editable=true) {
 let state={lists:[{id:'default',name:'First',tickers:['MU','NVDA']},{id:'my-list-2',name:'Second',tickers:['MU']}],names:{MU:'Micron'},alerts:[{ticker:'MU',price:200,direction:'above',currency:'USD'}]}, writes=0,index=0,tree;
 const slots=[], messages=[]; let accepted=false;
 const target={exports:{}};
 new Function('require','module','exports','window',compiled)(id=>{
  if(id==='react')return {useEffect:()=>{},useRef:()=>({current:null}),useState:initial=>{const key=index++;if(!(key in slots))slots[key]=initial;return [slots[key],v=>{slots[key]=v;}];}};
  if(id==='react/jsx-runtime')return require(id);
  if(id==='./use-favorite-lists')return {useFavoriteLists:()=>({...state,editable,ready:true,status:'synced',update:change=>{writes++;state=change(state);return true;}})};
  if(id==='./use-watchlist-selection')return {useWatchlistSelection:()=>['default',()=>{}]};
  if(id==='../use-research-language')return {useResearchLanguage:()=>[lang,()=>{}]};
  if(id==='@/lib/research/price-alert-settings')return alerts;
  if(id==='@/lib/research/favorite-lists')return lists;
  if(id==='@/lib/research/watchlist-freshness')return freshness;
  if(id==='@/lib/research/watchlist-session')return {quoteForSession:()=>null};
  if(id==='./use-quote-clock')return {useQuoteClock:()=>Date.now()};
  if(id==='./use-watchlist-sectors')return {useWatchlistSectors:()=>({})};
  if(id==='@/lib/research/watchlist-sector')return {watchlistSector:()=>null};
  return {default:()=>null,TrashIcon:()=>null};
 },target,target.exports,{confirm:message=>{messages.push(message);return accepted;}});
 const nodes=(n=tree)=>!n||typeof n!=='object'?[]:[n,...[].concat(n.props?.children??[]).flat(Infinity).filter(child=>child!=null).flatMap(nodes)];
 const render=()=>{index=0;tree=target.exports.default({companies:[{ticker:'MU',name:'Micron'},{ticker:'NVDA',name:'NVIDIA'}]});};
 render();
 return {nodes,render,messages,get state(){return state;},get writes(){return writes;},accept(){accepted=true;},remove:()=>nodes().find(n=>n.props?.removeLabel?.includes('MU')).props.onRemove(),expand:()=>{nodes().find(n=>n.type==='button'&&n.props['aria-expanded']===false&&n.props.className===undefined&&!n.props['aria-label']).props.onClick();render();}};
}
test('cancelled swipe removal writes nothing; confirmed removal preserves other lists, names and alerts',()=>{
 const h=harness(), original=h.state;
 assert.equal(h.remove(),false);assert.equal(h.writes,0);assert.strictEqual(h.state,original);
 assert.deepEqual(h.messages,['MUをこのリストから削除しますか？']);
 h.accept();assert.equal(h.remove(),true);assert.equal(h.writes,1);
 assert.deepEqual(h.state.lists[0].tickers,['NVDA']);assert.strictEqual(h.state.lists[1],original.lists[1]);
 assert.strictEqual(h.state.names,original.names);assert.strictEqual(h.state.alerts,original.alerts);
});
test('expanded detail removal uses the same confirmation in English',()=>{
 const h=harness('en');h.expand();
 const button=h.nodes().find(n=>n.type==='button'&&n.props['aria-label']==='Remove MU from this list');
 button.props.onClick();assert.equal(h.writes,0);assert.equal(h.messages[0],'Remove MU from this list?');
 h.accept();button.props.onClick();assert.deepEqual(h.state.lists[0].tickers,['NVDA']);
});
test('uneditable watchlists cannot trigger a removal or confirmation',()=>{
 const h=harness('ja',false);h.accept();assert.equal(h.remove(),false);assert.equal(h.writes,0);assert.deepEqual(h.messages,[]);
});
