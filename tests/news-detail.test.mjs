import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { additionalNewsDetail } from '../lib/research/news-detail.ts';
import { marketNewsBody } from '../lib/research/market-news-display.ts';
import { officialNewsDisplay } from '../lib/research/news-presentation.ts';
import { resultFactText, resultNewsUpdate, mergeResultNews } from '../lib/research/result-news.ts';
import { parseResultBriefs } from '../lib/research/market-results.ts';
import { publicNewsPayload } from '../lib/research/general-news.ts';

const require=createRequire(import.meta.url);
const source=(await readFile(new URL('../app/research/news/news-story.tsx',import.meta.url),'utf8'))
  .replace('import styles from "./general-news.module.css";', 'const styles={story:"story",shortStory:"shortStory",tickers:"tickers",headline:"headline",note:"note",expand:"expand",body:"body",source:"source",srOnly:"srOnly"};');
const compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText
  .replace('"react/jsx-runtime"',JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
const {default:NewsStory}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const props={label:'国債',title:'米国10年物国債利回りが再び急上昇中',publication:'発表 2026/10/3 4:07:25 JST',lang:'ja',
  source:{publisher:'Barchart',url:'https://x.com/Barchart/status/2106098746266136677'}};

// Captured published wording; the retained source has no yield level or change.
const bond={titleJa:props.title,titleEn:'U.S. 10-Year Treasury Yield ripping again',topic:'government-bonds'};
// Synthetic source-backed grammar tests, not an independent claim about a live release.
const jobs={id:'1176',researchId:'x-result-1176',kind:'economic',ticker:'ECON',period:'SEPTEMBER JOBS REPORT',
  titleJa:'非農業部門雇用者数 +29K／失業率 4.2%／平均時給（前年比） 3.0%',
  titleEn:'Nonfarm payrolls +29K; Unemployment rate 4.2%; Average hourly earnings (YoY) 3.0%',
  facts:[{key:'nonfarm-payrolls',ja:'非農業部門雇用者数',en:'Nonfarm payrolls',value:'+29K',comparisons:{forecast:'+90K'}},
    {key:'unemployment-rate',ja:'失業率',en:'Unemployment rate',value:'4.2%',comparisons:{forecast:'4.1%'}},
    {key:'hourly-earnings-yoy',ja:'平均時給（前年比）',en:'Average hourly earnings (YoY)',value:'3.0%',comparisons:{forecast:'3.1%'}}],
  url:'https://x.com/wallstengine/status/777',publisher:'Wall St Engine',publishedAt:'2026-10-02T12:30:37Z',
  observedAt:'2026-10-02T12:49:12.663Z',publicAt:'2026-10-02T12:49:15.319Z',processingMs:0,sourceToDetectionMs:1115663,detectionToPublicMs:2656};

test('headline duplicates and reformatted metric lists cannot claim additional details',()=>{
  for(const lang of ['ja','en']) assert.equal(marketNewsBody(bond,lang),undefined);
  assert.equal(additionalNewsDetail('NFP +29K; Unemployment 4.2%','NFP: +29K\nUnemployment: 4.2%'),undefined);
  assert.equal(additionalNewsDetail('非農業部門雇用者数 ＋29K／失業率 4.2%','非農業部門雇用者数：+29K\n失業率：4.2%'),undefined);
  assert.equal(additionalNewsDetail('News'),undefined);
  assert.equal(additionalNewsDetail('News',' \n '),undefined);
  assert.equal(additionalNewsDetail('News','News\nNew verified detail.\nNew verified detail.'),'New verified detail.');
  assert.equal(additionalNewsDetail('Yield 1.25%','Yield 125%'),'Yield 125%');
  assert.equal(additionalNewsDetail('NFP +29K','NFP -29K'),'NFP -29K');
  assert.equal(additionalNewsDetail('NFP +29K','NFP: +29K (Wall St Engine / TipRanks)',['Wall St Engine','TipRanks']),undefined);
});

test('brief rendering has one headline, accessible original and no fake disclosure or badge',()=>{
  const html=renderToStaticMarkup(React.createElement(NewsStory,{...props,body:marketNewsBody(bond,'ja')}));
  assert.equal(html.split(props.title).length-1,1);
  assert.doesNotMatch(html,/<details|<summary|＋|短報|4\.32%|basis points/);
  assert.ok(html.includes(props.source.url));
  assert.match(html,/Barchart · 原文/);
});

test('only real added facts use native keyboard and touch accessible disclosure',()=>{
  for(const lang of ['ja','en']) {
    const html=renderToStaticMarkup(React.createElement(NewsStory,{...props,lang,body:'Additional verified fact'}));
    assert.match(html,/<details class="story"><summary>/);
    assert.doesNotMatch(html,/<details[^>]+open=/);
    assert.match(html,/aria-hidden="true">＋/);
    assert.ok(html.includes(lang==='ja'?'詳細を開閉':'Toggle details'));
    assert.equal(html.split(props.title).length-1,1);
    assert.equal(html.split('Additional verified fact').length-1,1);
  }
});

test('optional economic detail keeps actual, forecast, prior and revision roles separate in JA and EN',()=>{
  const fact={...jobs.facts[0],comparisons:{forecast:'+90K',previous:'+54K',previousRevisedFrom:'+60K'}};
  assert.equal(resultFactText(fact,'ja'),'非農業部門雇用者数：+29K（予想 +90K／前回 +54K［+60Kから改定］）');
  assert.equal(resultFactText(fact,'en'),'Nonfarm payrolls: +29K (Forecast +90K; Previous +54K [revised from +60K])');
  const [brief]=parseResultBriefs([jobs]);
  const feed=publicNewsPayload({ok:true,enabled:false,items:[],resultBriefs:[brief],officialUpdates:[resultNewsUpdate(brief)]});
  for(const lang of ['ja','en']) {
    const display=officialNewsDisplay(feed.officialUpdates[0],lang);
    assert.equal(display.title,lang==='ja'?jobs.titleJa:jobs.titleEn);
    for(const value of ['+90K','4.1%','3.1%']) assert.ok(display.body.includes(value));
    assert.doesNotMatch(display.body,/MoM|前月比|revision|改定|surprise|予想を/);
  }
  assert.equal(feed.officialUpdates[0].publishedAt,'2026-10-02T12:30:37.000Z');
  assert.equal(feed.officialUpdates[0].observedAt,jobs.observedAt);
});

test('partial, malformed or missing optional detail does not hide a valid actual headline',()=>{
  for(const comparisons of [undefined,{},[],{forecast:'PRIVATE PROSE',previous:'4.1%',previousRevisedFrom:'+60K'}]) {
    const [brief]=parseResultBriefs([{...jobs,facts:[{...jobs.facts[0],comparisons}]}]);
    assert.equal(brief.facts[0].value,'+29K');
    assert.equal(brief.facts[0].comparisons,undefined);
  }
  const [brief]=parseResultBriefs([{...jobs,facts:jobs.facts.map(fact=>({...fact,comparisons:undefined}))}]);
  for(const lang of ['ja','en']) assert.equal(officialNewsDisplay(resultNewsUpdate(brief),lang).body,undefined);
  const [partial]=parseResultBriefs([{...jobs,facts:[{...jobs.facts[0],comparisons:{forecast:'+90K',previous:'bad'}}]}]);
  assert.deepEqual(partial.facts[0].comparisons,{forecast:'+90K'});
  const [earnings]=parseResultBriefs([{...jobs,kind:'earnings',ticker:'MU'}]);
  assert.ok(earnings.facts.every(f=>!f.comparisons));
});

test('merged sources cannot erase or blend distinct forecasts for the same actual',()=>{
  const other={...jobs,id:'1177',researchId:'x-result-1177',url:'https://x.com/tipranks/status/778',publisher:'TipRanks',
    facts:[{...jobs.facts[0],comparisons:{forecast:'+85K'}}]};
  const briefs=parseResultBriefs([jobs,other]);
  const [merged]=mergeResultNews(briefs.map(resultNewsUpdate),briefs);
  assert.match(merged.bodyEn,/Forecast:?[ ]\+90K.*Wall St Engine/);
  assert.match(merged.bodyEn,/Forecast:?[ ]\+85K.*TipRanks/);
  assert.equal(merged.title,jobs.titleEn);
});
