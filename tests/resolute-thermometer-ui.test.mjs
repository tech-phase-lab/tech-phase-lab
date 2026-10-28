import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { gaugeReading, gaugeStatus, expireThermometerSnapshot } from '../lib/resolute/thermometer-view.ts';
const unavailable={status:'unavailable',reason:'not-configured'};
const reading=(index,score)=>({status:'ready',version:'daily-close-v1',index,asOf:'2026-10-23',referenceFrom:'2016-10-23',observations:2500,score,band:Math.min(4,Math.floor(score/20)),drawdownPercent:-12.5,deviationPercent:3.2,drawdownPercentile:40,deviationPercentile:70});
const snapshot=()=>({asOf:'2026-10-23',nas100:reading('nas100',90),sox:reading('sox',30),vix:unavailable});
test('selected-index reading rejects invalid score, wrong index/day and inconsistent band',()=>{
 const s=snapshot();assert.equal(gaugeReading(s,'sox').score,30);
 for(const patch of [{score:NaN},{score:101},{index:'nas100'},{asOf:'2026-10-22'},{band:4},{deviationPercent:Infinity}])assert.equal(gaugeReading({...s,sox:{...s.sox,...patch}},'sox'),null);
 assert.equal(gaugeReading({...s,sox:unavailable},'sox'),null);
 assert.match(gaugeStatus(undefined,'nas100',false),/準備中/);
 assert.match(gaugeStatus({...s,sox:{status:'unavailable',reason:'stale-data'}},'sox',true),/confirmed closing/);
});
test('actual gauge switches indices immediately, clears missing readings and isolates preview values in both languages',async()=>{
 const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const dir=await mkdtemp(join(process.cwd(),'.gauge-render-'));
 const state=globalThis.__gaugeUI={values:[],cursor:0,review:null,useState(initial){const i=this.cursor++;if(!(i in this.values))this.values[i]=initial;return [this.values[i],v=>{this.values[i]=v;}];}};
 try{
  const outfile=join(dir,'screen.cjs');
  await build({entryPoints:['app/resolute/thermometer/screen.tsx'],outfile,bundle:true,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'},plugins:[{name:'isolated-gauge',setup(b){
   b.onLoad({filter:/thermometer\/screen\.tsx$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('import { useState } from "react";','const useState = initial => globalThis.__gaugeUI.useState(initial);'),loader:'tsx'}));
   b.onResolve({filter:/^\.\.\/(tool-shell|review-context|flow-navigation)$/},args=>({path:args.path,namespace:'gauge-stub'}));
   b.onLoad({filter:/.*/,namespace:'gauge-stub'},()=>({contents:'export default function Stub(){return null};export const useReview=()=>globalThis.__gaugeUI.review;',loader:'js'}));
  }}]});
  const homefile=join(dir,'home.cjs');
  await build({entryPoints:['app/resolute/home/market-gauge-card.tsx'],outfile:homefile,bundle:true,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'},plugins:[{name:'home-link',setup(b){
   b.onResolve({filter:/review-context$/},args=>({path:args.path,namespace:'home-stub'}));
   b.onLoad({filter:/.*/,namespace:'home-stub'},()=>({contents:'import React from "react"; export const ReviewLink=props=>React.createElement("a",props);',loader:'js'}));
  }}]});
  const HomeCard=require(homefile).default;
  const {MarketGauge}=require(outfile);
  const render=(locale,s)=>{state.cursor=0;const tree=MarketGauge({locale,snapshot:s});return {tree,html:renderToStaticMarkup(tree)};};
  const buttons=node=>!node||typeof node!=='object'?[]:[...(node.type==='button'?[node]:[]),...React.Children.toArray(node.props?.children).flatMap(buttons)];
  for(const locale of ['ja','en']){
   state.values=[];state.review=null;
   let r=render(locale,snapshot());assert.match(r.html,/rotate\(72 150 150\)/);assert.match(r.html,/-12.5%/);assert.match(r.html,/\+3.2%/);
   buttons(r.tree).find(b=>b.props.children==='SOX').props.onClick();
   r=render(locale,snapshot());assert.match(r.html,/rotate\(-36 150 150\)/);assert.match(r.html,/aria-pressed="true">SOX/);
   r=render(locale,{...snapshot(),sox:unavailable});assert.doesNotMatch(r.html,/rotate\(/);assert.doesNotMatch(r.html,/-12.5%/);
   state.review={scenario:'sample'};r=render(locale,snapshot());assert.match(r.html,locale==='ja'?/表示見本・実際の相場ではありません/:/Not actual market data/);assert.doesNotMatch(r.html,/-12.5%/);
   state.review={scenario:'live'};r=render(locale,undefined);assert.doesNotMatch(r.html,/rotate\(/);assert.doesNotMatch(r.html,/Not actual market data|表示見本・実際/);
  }
  for(const locale of ['ja','en']) {
   state.review=null;
   const home=value=>renderToStaticMarkup(React.createElement(HomeCard,{locale,snapshot:value}));
   for(const score of [0,30,50,70,100]) {
    state.values=[];
    const value={...snapshot(),nas100:reading('nas100',score)};
    const detail=render(locale,value).html,card=home(value);
    const label=(locale==='ja'?['冷えている','やや冷え','平常','やや熱い','熱い']:['Cool','Slightly cool','Normal','Slightly hot','Hot'])[Math.min(4,Math.floor(score/20))];
    assert.ok(detail.includes(label));assert.ok(card.includes(label));
    assert.match(detail,/2026-10-23/);assert.match(card,/2026-10-23/);
    assert.ok(card.includes(`left:${score}%`));assert.match(card,/NASDAQ100/);
   }
   const value={...snapshot(),validUntil:1000};
   assert.equal(expireThermometerSnapshot(value,999),value);
   const expired=expireThermometerSnapshot(value,1000);
   state.values=[];
   const detail=render(locale,expired).html,card=home(expired);
   const waiting=gaugeStatus(expired,'nas100',locale==='en');
   assert.ok(detail.includes(waiting));assert.ok(card.includes(waiting));
   assert.doesNotMatch(card,/left:|2026-10-23/);assert.doesNotMatch(detail,/rotate\(/);
   assert.doesNotMatch(home({...snapshot(),nas100:unavailable}),/left:|2026-10-23/);
   const sample=renderToStaticMarkup(React.createElement(HomeCard,{locale,snapshot:value,sample:true}));
   assert.match(sample,/left:86%/);assert.doesNotMatch(sample,/2026-10-23/);
   assert.ok(sample.includes(locale==='ja'?'表示見本':'Display sample'));
  }
 }finally{delete globalThis.__gaugeUI;await rm(dir,{recursive:true,force:true});}
});
