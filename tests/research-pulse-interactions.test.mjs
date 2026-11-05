import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// A deterministic hook harness, not a mobile browser simulation.
let active;
const runtime={feed:null,reduced:false,timers:new Map(),delays:[],serial:0};
const slot=initial=>{const index=active.cursor++;if(!(index in active.slots))active.slots[index]=initial();return index;};
runtime.useState=initial=>{const owner=active,index=slot(()=>typeof initial==='function'?initial():initial);return [owner.slots[index],value=>{owner.slots[index]=typeof value==='function'?value(owner.slots[index]):value;}];};
runtime.useRef=initial=>{const index=slot(()=>({current:initial}));return active.slots[index];};
runtime.useEffect=(callback,deps)=>{const owner=active,index=slot(()=>null),old=owner.slots[index];if(!old||!deps||deps.some((x,i)=>!Object.is(x,old.deps[i])))owner.effects.push(()=>{old?.cleanup?.();owner.slots[index]={deps,cleanup:callback()};});};
runtime.useSyncExternalStore=(_,snapshot)=>snapshot();
runtime.window={matchMedia:()=>({matches:runtime.reduced})};
runtime.document={hidden:false,fonts:{ready:{then:()=>{}}}};
runtime.setInterval=(callback,ms)=>{const id=++runtime.serial;runtime.timers.set(id,callback);runtime.delays.push(ms);return id;};
runtime.clearInterval=id=>runtime.timers.delete(id);
runtime.setTimeout=()=>0;runtime.clearTimeout=()=>{};
globalThis.__pulseInteractionRuntime=runtime;
const require=createRequire(import.meta.url);
let source=await readFile(new URL('../app/research/research-pulse.tsx',import.meta.url),'utf8');
source=source.replace('import { useEffect, useRef, useState, useSyncExternalStore } from "react";',
  'const runtime=globalThis.__pulseInteractionRuntime; const {useEffect,useRef,useState,useSyncExternalStore,window,document,setInterval,clearInterval,setTimeout,clearTimeout}=runtime;');
source=source.replace('import { newsSnapshot, serverNewsSnapshot, subscribeNews } from "@/lib/research/news-snapshot";','const newsSnapshot=()=>runtime.feed;const serverNewsSnapshot=newsSnapshot;const subscribeNews=()=>()=>{};');
source=source.replace('import { WATCH_TICKERS } from "@/lib/research/flash-rows";','const WATCH_TICKERS = new Set(["NVDA"]);');
for(const name of ['news-pulse-items','news-time','news-band','company-wire','wire-store','news-startup'])source=source.replace(`"@/lib/research/${name}"`,JSON.stringify(new URL(`../lib/research/${name}.ts`,import.meta.url).href));
source=source.replace('const [wireSettled, setWireSettled] = useState(false);','const [wireSettled, setWireSettled] = useState(true);').replace('const [gaveUp, setGaveUp] = useState(false);','const [gaveUp, setGaveUp] = useState(true);');
source=source.replace('import styles from "./research-pulse.module.css";','const styles={pulse:"pulse",strip:"strip",item:"item",in:"in",out:"out",live:"live",hd:"hd",sym:"sym",tm:"tm",wave:"wave",flash:"flash",slot:"slot"};');
const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText.replace('"react/jsx-runtime"',JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
const {default:ResearchPulse}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
function context(){return {cursor:0,slots:[],effects:[]};}
function render(owner,props){active=owner;owner.cursor=0;owner.effects=[];const tree=ResearchPulse(props);owner.effects.forEach(run=>run());return tree;}
const news=(id,at,ja)=>({id,publisher:'Issuer',tickers:['NVDA'],url:`https://developer.nvidia.com/blog/test-${id}`,title:`NVDA headline ${id}`,translationJa:ja,pulseTitleJa:ja,publishedAt:at,observedAt:at});
const shown=tree=>tree.props.children[0].props.children.find(child=>child&&child.props?.line&&!child.props.leaving).props.line;
function reset(){runtime.timers.clear();runtime.delays=[];runtime.reduced=false;}

test('the band changes every five seconds, holds while pressed, resumes on release, and stops entirely with reduced motion',()=>{
  reset();const owner=context();
  runtime.feed={checkedAt:Date.parse('2026-10-04T10:00:00Z'),data:{ok:true,enabled:false,items:[],officialUpdates:[news('a','2026-10-03T23:15:00Z','NVDA、新製品を発表'),news('b','2026-10-03T22:15:00Z','NVDA、増配を発表')]}};
  let tree=render(owner,{lang:'ja'});
  assert.deepEqual(runtime.delays,[5000]);assert.equal(runtime.timers.size,1);
  const first=shown(tree).id;
  [...runtime.timers.values()][0]();tree=render(owner,{lang:'ja'});
  assert.notEqual(shown(tree).id,first);assert.equal(shown(tree).band,'NVDA、増配を発表');
  tree.props.onPointerDown();tree=render(owner,{lang:'ja'});
  assert.equal(runtime.timers.size,0,'no change while pressed');
  tree.props.onPointerUp();tree=render(owner,{lang:'ja'});
  assert.equal(runtime.timers.size,1,'resumes on release');
  tree.props.onPointerDown();tree=render(owner,{lang:'ja'});tree.props.onPointerLeave();tree=render(owner,{lang:'ja'});assert.equal(runtime.timers.size,1,'sliding the finger off also releases');
  runtime.reduced=true;tree=render(owner,{lang:'ja'});assert.equal(runtime.timers.size,0);
  assert.equal(tree.props.children[1].props.className.includes('flash'),false);
  runtime.feed=null;assert.equal(render(owner,{lang:'ja'}),null);
});

test('a story with no short headline is skipped without stopping the band',()=>{
  reset();const owner=context();
  runtime.feed={checkedAt:Date.parse('2026-10-04T10:00:00Z'),data:{ok:true,enabled:false,items:[],officialUpdates:[news('a','2026-10-03T23:15:00Z','アメリカの大手半導体メーカーが過去最高の売上高を発表しました本日'),news('b','2026-10-03T22:15:00Z','NVDA、増配を発表')]}};
  const tree=render(owner,{lang:'ja'});
  assert.equal(shown(tree).band,'NVDA、増配を発表');
  assert.equal(runtime.timers.size,0,'one story: nothing to rotate to');
});
