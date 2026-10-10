import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// A deterministic hook/DOM-metrics harness, not a mobile browser simulation.
let active, serial=0;
const runtime={feed:null,reduced:false,frames:new Map(),timers:new Map(),observers:[],fonts:[],factor:7};
const slot=initial=>{const index=active.cursor++;if(!(index in active.slots))active.slots[index]=initial();return index;};
runtime.useState=initial=>{const owner=active,index=slot(()=>typeof initial==='function'?initial():initial);return [owner.slots[index],value=>{const next=typeof value==='function'?value(owner.slots[index]):value;if(next!==owner.slots[index])owner.updates++;owner.slots[index]=next;}];};
runtime.useRef=initial=>{const index=slot(()=>({current:initial}));return active.slots[index];};
runtime.useEffect=(callback,deps)=>{const owner=active,index=slot(()=>null),old=owner.slots[index];if(!old||deps.some((x,i)=>!Object.is(x,old.deps[i])))owner.effects.push(()=>{old?.cleanup?.();owner.slots[index]={deps,cleanup:callback()};});};
runtime.useSyncExternalStore=(_,snapshot)=>snapshot();
runtime.window={matchMedia:()=>({matches:runtime.reduced})};
runtime.document={hidden:false,createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:text.length*runtime.factor})})}),fonts:{ready:{then:callback=>runtime.fonts.push(callback)}}};
runtime.getComputedStyle=()=>({font:'12px Arial'});
runtime.ResizeObserver=class {constructor(callback){this.callback=callback;this.disconnected=false;runtime.observers.push(this);}observe(){this.callback();}disconnect(){this.disconnected=true;}trigger(){if(!this.disconnected)this.callback();}};
runtime.requestAnimationFrame=callback=>{const id=++serial;runtime.frames.set(id,callback);return id;};
runtime.cancelAnimationFrame=id=>runtime.frames.delete(id);
runtime.setInterval=callback=>{const id=++serial;runtime.timers.set(id,callback);return id;};
runtime.clearInterval=id=>runtime.timers.delete(id);
globalThis.__pulseInteractionRuntime=runtime;
const require=createRequire(import.meta.url);
let source=await readFile(new URL('../app/research/research-pulse.tsx',import.meta.url),'utf8');
source=source.replace('import { useEffect, useRef, useState, useSyncExternalStore } from "react";',
  'const runtime=globalThis.__pulseInteractionRuntime; const {useEffect,useRef,useState,useSyncExternalStore,window,document,getComputedStyle,ResizeObserver,requestAnimationFrame,cancelAnimationFrame,setInterval,clearInterval}=runtime;');
source=source.replace('import { newsSnapshot, serverNewsSnapshot, subscribeNews } from "@/lib/research/news-snapshot";',
  'const newsSnapshot=()=>runtime.feed;const serverNewsSnapshot=newsSnapshot;const subscribeNews=()=>()=>{};');
for(const name of ['news-pulse-items','news-pulse-headline','news-time'])source=source.replace(`"@/lib/research/${name}"`,JSON.stringify(new URL(`../lib/research/${name}.ts`,import.meta.url).href));
source=source.replace('import styles from "./research-pulse.module.css";','const styles={pulse:"pulse",headline:"headline",clipped:"clipped",clock:"clock",eastern:"eastern",fresh:"fresh",progress:"progress"};');
source+='\nexport { FittedHeadline };';
const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText.replace('"react/jsx-runtime"',JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
const {default:ResearchPulse,FittedHeadline}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
function context(){return {cursor:0,slots:[],effects:[],updates:0};}
function render(owner,component,props,target){active=owner;owner.cursor=0;owner.effects=[];const tree=component(props);if(target&&tree?.props.ref)tree.props.ref.current=target;owner.effects.forEach(run=>run());return tree;}
function flushFrames(){const callbacks=[...runtime.frames.values()];runtime.frames.clear();callbacks.forEach(run=>run());}
function dispose(owner){owner.slots.forEach(value=>value?.cleanup?.());}
function reset(){runtime.frames.clear();runtime.timers.clear();runtime.observers=[];runtime.fonts=[];runtime.factor=7;runtime.reduced=false;}

 test('font-load and repeated ResizeObserver notifications coalesce; whole alternatives remain stable without oscillation',()=>{
  reset();const owner=context(),element={clientWidth:124},props={headlines:['Long full headline','Short title'],lang:'en',label:'News'};
  let tree=render(owner,FittedHeadline,props,element);
  assert.equal(tree.props.children,'Short title');
  runtime.observers[0].trigger();runtime.observers[0].trigger();runtime.fonts[0]();
  assert.equal(runtime.frames.size,1);
  flushFrames();tree=render(owner,FittedHeadline,props,element);assert.equal(tree.props.children,'Short title');
  const updates=owner.updates;
  runtime.observers[0].trigger();runtime.fonts[0]();flushFrames();render(owner,FittedHeadline,props,element);
  assert.equal(owner.updates,updates);
  element.clientWidth=160;runtime.observers[0].trigger();flushFrames();tree=render(owner,FittedHeadline,props,element);assert.equal(tree.props.children,'Long full headline');
  runtime.factor=10;runtime.fonts[0]();flushFrames();tree=render(owner,FittedHeadline,props,element);assert.equal(tree.props.children,'Short title');
  const stable=owner.updates;for(let i=0;i<3;i++){runtime.observers[0].trigger();flushFrames();render(owner,FittedHeadline,props,element);}assert.equal(owner.updates,stable);
  dispose(owner);assert.equal(runtime.observers[0].disconnected,true);
});

test('headline/language changes and unmount cancel stale font/resize work',()=>{
  reset();const owner=context(),element={clientWidth:200};
  render(owner,FittedHeadline,{headlines:['Original full headline','Original topic'],lang:'en',label:'News'},element);
  const oldFont=runtime.fonts[0];
  render(owner,FittedHeadline,{headlines:['新しい短い見出し','ニュース'],lang:'ja',label:'ニュース'},element);
  assert.equal(runtime.observers[0].disconnected,true);
  oldFont();assert.equal(runtime.frames.size,1);flushFrames();
  const tree=render(owner,FittedHeadline,{headlines:['新しい短い見出し','ニュース'],lang:'ja',label:'ニュース'},element);
  assert.equal(tree.props.children,'新しい短い見出し');
  runtime.observers[1].trigger();dispose(owner);assert.equal(runtime.frames.size,0);
  const updates=owner.updates;runtime.fonts[1]();flushFrames();assert.equal(owner.updates,updates);
});

test('rotation, pause/resume, arrows, language changes and swipe preserve one clock/control without header expansion',()=>{
  reset();const owner=context();
  const news=(id,at)=>({id,publisher:'Issuer',tickers:['NVDA'],url:`https://developer.nvidia.com/blog/test-${id}`,title:`NVDA short headline ${id}`,translationJa:`短い見出し${id}`,publishedAt:at,observedAt:at});
  runtime.feed={checkedAt:Date.parse('2026-10-04T10:00:00Z'),data:{ok:true,enabled:false,items:[],officialUpdates:[news('a','2026-10-03T23:15:00Z'),news('b','2026-10-02T23:15:00Z')]}};
  const draw=(lang='ja')=>render(owner,ResearchPulse,{lang});
  const controls=tree=>tree.props.children.filter(child=>child?.type==='button');
  let tree=draw();const initial=tree.props.children[0].key;
  assert.equal(runtime.timers.size,1);assert.equal(controls(tree).length,1);assert.equal(tree.props.children[1].props.dateTime,'2026-10-03T23:15:00Z');
  controls(tree)[0].props.onClick();tree=draw();assert.equal(runtime.timers.size,0);assert.equal(controls(tree)[0].props['aria-pressed'],true);
  let prevented=0;tree.props.onKeyDown({key:'ArrowRight',preventDefault:()=>prevented++});tree=draw();assert.notEqual(tree.props.children[0].key,initial);assert.equal(prevented,1);
  controls(tree)[0].props.onClick();tree=draw('en');assert.equal(runtime.timers.size,1);assert.equal(controls(tree)[0].props['aria-label'],'Pause rotation');
  [...runtime.timers.values()][0]();tree=draw('en');assert.equal(tree.props.children[0].key,initial);
  tree.props.onTouchStart({touches:[{clientX:200,clientY:10}]});tree=draw('en');assert.equal(runtime.timers.size,0);
  tree.props.onTouchEnd({changedTouches:[{clientX:100,clientY:12}]});tree=draw('en');assert.notEqual(tree.props.children[0].key,initial);
  let preventedClick=0;tree.props.onClickCapture({preventDefault:()=>preventedClick++,stopPropagation:()=>preventedClick++});assert.equal(preventedClick,2);
  assert.equal(tree.props['aria-expanded'],undefined);assert.equal(tree.props.children[0].props.onClick,undefined);
  runtime.reduced=true;tree=draw('en');assert.equal(runtime.timers.size,0);assert.equal(controls(tree)[0].props.disabled,true);
  runtime.feed=null;assert.equal(draw(),null);dispose(owner);assert.equal(runtime.timers.size,0);
});
