import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { stockSearchUrl, stockSearchReturnPosition } from '../lib/research/stock-search-navigation.ts';
const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL('../app/research/stocks/stock-directory.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const entries = [{ ticker:'VS',cik:1,exchange:'NASDAQ',name:'Versus' },{ ticker:'VST',cik:2,exchange:'NYSE',name:'Vistra' }];
function harness(t, initial='/research/stocks?q=VS') {
  const saved = { window:globalThis.window, fetch:globalThis.fetch, requestAnimationFrame:globalThis.requestAnimationFrame };
  const slots=[], effects=[], timers=new Map(), frames=new Map(), stack=[{url:initial,state:null}], requests=[];
  let index=0, cursor=0, dirty=true, tree, timerId=0;
  const hooks={
    useState(value){const id=index++; if(!(id in slots))slots[id]=value; return [slots[id],next=>{const v=typeof next==='function'?next(slots[id]):next;if(!Object.is(v,slots[id])){slots[id]=v;dirty=true;}}];},
    useRef(value){const id=index++;return slots[id]??(slots[id]={current:value});},
    useEffect(fn,deps){const id=index++;const prior=slots[id];if(!prior||deps.some((d,i)=>!Object.is(d,prior.deps[i]))){effects.push(()=>{prior?.cleanup?.();slots[id]={deps,cleanup:fn()};});}},
    useEffectEvent(fn){const id=index++;if(!slots[id])slots[id]={fn,call:(...args)=>slots[id].fn(...args)};slots[id].fn=fn;return slots[id].call;}
  };
  const history={get state(){return stack[cursor].state;},replaceState(state,_,url){if(state)state.__NA=true;stack[cursor]={state,url};dirty=true;},pushState(state,_,url){assert.equal(state?.__NA,undefined,'do not reuse a Next.js-decorated replaceState argument');stack.splice(cursor+1);stack.push({state,url});cursor++;dirty=true;},back(){cursor=Math.max(0,cursor-1);dirty=true;},forward(){cursor=Math.min(stack.length-1,cursor+1);dirty=true;}};
  globalThis.window={history,scrollY:620,scrollTo:({top})=>{window.scrollY=top;},setTimeout:fn=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>{const id=++timerId;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)};
  globalThis.requestAnimationFrame=window.requestAnimationFrame;
  globalThis.fetch=url=>new Promise(resolve=>requests.push({url,resolve}));
  const mod={exports:{}};
  new Function('require','module','exports',compiled)(name=>{
    if(name==='react')return {...require('react'),...hooks};
    if(name==='next/navigation')return {useSearchParams:()=>new URL(stack[cursor].url,'https://example.test').searchParams};
    if(name==='../use-research-language')return {useResearchLanguage:()=>['ja',()=>{}]};
    if(name==='../use-stock-favorites')return {useStockFavorites:()=>({favorites:[],toggle:()=>{},editable:true})};
    if(name==='./use-stock-history')return {useStockHistory:()=>({history:[],remember:()=>{},clear:()=>{}})};
    if(name==='@/lib/research/stock-search-navigation')return {stockSearchUrl,stockSearchReturnPosition};
    if(name==='react/jsx-runtime')return require(name);
    return {default:()=>null,MarketWorkspace:()=>null};
  },mod,mod.exports);
  function nodes(node=tree){if(!node||typeof node!=='object')return [];return [node,...[].concat(node.props?.children??[]).flat(Infinity).filter(child=>child!=null).flatMap(child=>nodes(child))];}
  function render(){for(let count=0;dirty&&count<25;count++){dirty=false;index=0;tree=mod.exports.default();for(const run of effects.splice(0))run();}assert.equal(dirty,false,'render settles');for(const [id,fn] of [...frames]){frames.delete(id);fn();}}
  async function answer(request,data){request.resolve({ok:true,json:async()=>data});await new Promise(r=>setImmediate(r));render();}
  t.after(()=>{Object.assign(globalThis,saved);});
  render();
  return {render,nodes,history,requests,stack,url:()=>stack[cursor].url,runSearch:async()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn();}await answer(requests.at(-1),{ok:true,results:entries});},answer,
    open:()=>{nodes().find(n=>n.type==='button'&&n.props.children?.[0]?.props?.children==='VST').props.onClick();render();}};
}
test('detail Back restores matches, query and scroll; late profile responses cannot reopen it',async t=>{
 const h=harness(t);await h.runSearch();h.open();assert.match(h.url(),/stock=VST/);assert.equal(h.stack.length,2);
 const profile=h.requests.at(-1);window.scrollY=20;h.history.back();h.render();assert.equal(h.url(),'/research/stocks?q=VS');assert.equal(window.scrollY,620);
 assert.equal(h.nodes().filter(n=>n.type==='button'&&n.props['aria-current']==='true').length,0);
 await h.answer(profile,{ok:true,profile:{ticker:'VST',name:'Vistra',recentFilings:[]}});
 assert.equal(h.nodes().filter(n=>n.props?.ticker==='VST').length,0);
 h.history.forward();h.render();assert.match(h.requests.at(-1).url,/ticker=VST/);
});
test('typing replaces stale URL query, without adding one Back step per keystroke',async t=>{
 const h=harness(t,'/research/stocks?q=APH');
 h.nodes().find(n=>n.type==='input').props.onChange({target:{value:'アリスタ & VS'}});h.render();
 assert.equal(new URL(h.url(),'https://example.test').searchParams.get('q'),'アリスタ & VS');assert.equal(h.stack.length,1);
});
test('a directly opened detail restores its selection and can return without leaving the site',async t=>{
 const h=harness(t,stockSearchUrl('VS','VST:2:NYSE'));await h.runSearch();assert.match(h.requests.at(-1).url,/ticker=VST/);
 h.nodes().find(n=>n.type==='button'&&n.props.children==='← 検索結果に戻る').props.onClick();h.render();assert.equal(h.url(),'/research/stocks?q=VS');
});
