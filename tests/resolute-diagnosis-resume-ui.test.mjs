import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { emptyDiagnosisDraft, draftFromPlan } from '../lib/resolute/diagnosis-form.ts';
import { createReviewSamplePlan } from '../lib/resolute/review-sample.ts';
import { readDiagnosisSession, writeDiagnosisSession, DIAGNOSIS_SESSION_TTL } from '../lib/resolute/diagnosis-session.ts';

// Execute the actual form's hooks and event handlers without a browser or network.
const compiled=await build({entryPoints:['app/resolute/screen.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty','.module.css':'empty'},plugins:[{
 name:'diagnosis-component-harness',setup(b){
  b.onLoad({filter:/app\/resolute\/screen\.tsx$/},async args=>({contents:(await readFile(args.path,'utf8'))+'\nexport {DiagnosisForm};',loader:'tsx'}));
  b.onResolve({filter:/^(react|react\/jsx-runtime)$/},args=>({path:args.path,namespace:'harness'}));
  b.onResolve({filter:/^\.\/(review-context|tool-shell|number-input|question-title|use-unsaved-changes)$/},args=>({path:args.path,namespace:'harness'}));
  b.onLoad({filter:/.*/,namespace:'harness'},({path})=>({contents:path==='react'?`
   export const useState=(...a)=>globalThis.__diagnosisHarness.useState(...a);
   export const useRef=(...a)=>globalThis.__diagnosisHarness.useRef(...a);
   export const useEffect=(...a)=>globalThis.__diagnosisHarness.useEffect(...a);
   export const useCallback=(...a)=>globalThis.__diagnosisHarness.useCallback(...a);`
   :path==='react/jsx-runtime'?`export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment='fragment';`
   :path==='./review-context'?`export const ReviewLink='a';export const usePlanClient=()=>globalThis.__diagnosisHarness.requestPlan;export const useReview=()=>globalThis.__diagnosisHarness.review;`
   :path==='./use-unsaved-changes'?`export const useUnsavedChanges=()=>{};`
   :`export default 'mock-component';`}));
 }
}]});
const {DiagnosisForm}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
function memory(){const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};}
function initial(){const draft=emptyDiagnosisDraft();draft.answers.q01='first';return {session:'test-session',channel:'preview',expiresAt:Date.now()+DIAGNOSIS_SESSION_TTL-1000,draft,baseline:'null',mode:'questions',index:1,locked:false,active:true,locale:'ja'};}
function nodes(node){return !node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];}
function text(node){return typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';}
function harness(requestPlan,storage){
 const slots=[];let cursor=0,dirty=true,effects=[],tree;
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const h={review:{path:'/resolute/diagnosis'},requestPlan,
  useState(init){const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return [slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},
  useRef(value){const i=cursor++;return slots[i]??=( {current:value} );},
  useCallback(fn,deps){const i=cursor++;if(!equal(slots[i]?.deps,deps))slots[i]={fn,deps};return slots[i].fn;},
  useEffect(fn,deps){const i=cursor++;if(!equal(slots[i]?.deps,deps)){const previous=slots[i];slots[i]={deps};effects.push(()=>{previous?.cleanup?.();slots[i].cleanup=fn();});}},
  async flush(){for(let i=0;i<16;i++){if(dirty){dirty=false;cursor=0;tree=DiagnosisForm({locale:'ja',deny(){},draftSession:'test-session'});const pending=effects;effects=[];pending.forEach(fn=>fn());}await new Promise(resolve=>setImmediate(resolve));}assert.equal(dirty,false,'render settles');return tree;},
  button(label){const node=nodes(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(node,`button ${label}`);return node;},
  tree:()=>tree,
  unmount(){for(const slot of slots)slot?.cleanup?.();}
 };
 globalThis.__diagnosisHarness=h;globalThis.window={sessionStorage:storage,confirm:()=>true};return h;
}
const getPlan=async()=>({plan:null,revision:0});
test('answering two questions then remounting returns to Q03 with answers intact',async()=>{
 const oldWindow=globalThis.window;const s=memory();let h=harness(getPlan,s);
 try{
  await h.flush();h.button('はじめる').props.onClick();await h.flush();
  nodes(h.tree()).find(n=>n.type==='button'&&n.props['aria-pressed']===false).props.onClick();await h.flush();
  h.button('次へ').props.onClick();await h.flush();
  nodes(h.tree()).find(n=>n.type==='button'&&n.props['aria-pressed']===false).props.onClick();await h.flush();
  h.button('次へ').props.onClick();await h.flush();
  assert.equal(readDiagnosisSession('test-session','preview',s).index,2);
  h.unmount();h=harness(getPlan,s);await h.flush();
  assert.ok(text(h.tree()).includes('Q03'));assert.equal(readDiagnosisSession('test-session','preview',s).draft.answers.q02,'l15');
  h.button('途中の回答を破棄する').props.onClick();await h.flush();assert.equal(readDiagnosisSession('test-session','preview',s),null);
  assert.ok(h.button('はじめる'));
 }finally{h.unmount();globalThis.window=oldWindow;delete globalThis.__diagnosisHarness;}
});
test('save failures retain a locked result on reload; successful save removes the draft',async()=>{
 for(const succeed of [false,true]){
  const oldWindow=globalThis.window,s=memory(),value=initial();value.draft=draftFromPlan(createReviewSamplePlan());value.mode='result';writeDiagnosisSession(value,s);
  let writes=0;const request=async payload=>{if(!payload)return {plan:null,revision:0};writes++;assert.equal(readDiagnosisSession('test-session','preview',s).locked,true,'lock stored before request');if(!succeed)throw Error('offline');return {plan:payload.plan,revision:1};};
  let h=harness(request,s);
  try{
   await h.flush();await h.button('このルールを保存する').props.onClick();await h.flush();assert.equal(writes,1);
   if(succeed)assert.equal(readDiagnosisSession('test-session','preview',s),null);
   else{assert.equal(readDiagnosisSession('test-session','preview',s).locked,true);h.unmount();h=harness(request,s);await h.flush();assert.equal(h.button('このルールを保存する').props.disabled,true);assert.equal(writes,1);}
  }finally{h.unmount();globalThis.window=oldWindow;delete globalThis.__diagnosisHarness;}
 }
});
test('changed saved plan never silently rebases a restored draft onto the new revision',async()=>{
 const oldWindow=globalThis.window,s=memory(),value=initial();value.draft=draftFromPlan(createReviewSamplePlan());value.mode='result';writeDiagnosisSession(value,s);
 let writes=0;const h=harness(async payload=>{if(payload)writes++;return {plan:createReviewSamplePlan(),revision:4};},s);
 try{await h.flush();assert.equal(h.button('このルールを保存する').props.disabled,true);assert.ok(text(h.tree()).includes('別の画面で計画が更新'));assert.equal(writes,0);}
 finally{h.unmount();globalThis.window=oldWindow;delete globalThis.__diagnosisHarness;}
});
