import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require=createRequire(import.meta.url);
let source=await readFile(new URL('../app/research/research-pulse.tsx',import.meta.url),'utf8');
source=source.replace('import { newsSnapshot, serverNewsSnapshot, subscribeNews } from "@/lib/research/news-snapshot";',
  'const newsSnapshot = () => globalThis.__pulseTestSnapshot; const serverNewsSnapshot = newsSnapshot; const subscribeNews = () => () => {};');
for (const name of ['news-pulse-items','news-time']) {
  source=source.replace(`"@/lib/research/${name}"`,JSON.stringify(new URL(`../lib/research/${name}.ts`,import.meta.url).href));
}
source=source.replace('import styles from "./research-pulse.module.css";', 'const styles={pulse:"pulse",item:"item",fresh:"fresh",progress:"progress"};');
let compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText;
for(const name of ['react','react/jsx-runtime']) compiled=compiled.replaceAll(JSON.stringify(name),JSON.stringify(pathToFileURL(require.resolve(name)).href));
const {default:ResearchPulse}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));

const item={id:'1244',generalSource:1,tickers:['MU'],publisher:'Reported company news',
  url:'https://x.com/wallstengine/status/2106377353018626530',
  title:'MU: Broker business and industry outlook',translationJa:'MU：証券会社による事業・業界見通し',
  publishedAt:'2026-10-03T13:34:30.000Z',observedAt:'2026-10-03T13:34:43.668Z',
  bodyJa:'JPMorganの見方として報じられた内容：メモリー供給は2028年まで逼迫が続くと見込む。\n\n長い記事本文。',
  bodyEn:'Reported view of JPMorgan: Memory supply is expected to stay constrained through 2028.\n\nLong article body.'};

test('header has readable non-disclosure text and only a separate rotation button in JA and EN',()=>{
  globalThis.__pulseTestSnapshot={data:{ok:true,enabled:false,items:[],officialUpdates:[item]},checkedAt:Date.parse(item.publishedAt)};
  for(const lang of ['ja','en']) {
    const html=renderToStaticMarkup(React.createElement(ResearchPulse,{lang}));
    assert.match(html,/tabindex="0"/);
    assert.equal((html.match(/<button/g)??[]).length,1);
    assert.doesNotMatch(html,/aria-expanded|data-expanded|<details|長い記事本文|Long article body/);
    assert.match(html,/JPMorgan/);
    assert.match(html,/2028/);
    assert.match(html,/2026-10-03T13:34:30.000Z/);
    assert.match(html,/aria-label="(自動切替を停止|Pause rotation)"/);
  }
});

test('missing and failed feed snapshots render no stale or fabricated header news',()=>{
  for(const data of [null,{data:{ok:true,enabled:false,items:[]},checkedAt:0}]) {
    globalThis.__pulseTestSnapshot=data;
    assert.equal(renderToStaticMarkup(React.createElement(ResearchPulse,{lang:'ja'})),'');
  }
  delete globalThis.__pulseTestSnapshot;
});

test('header CSS wraps complete compact text without clipping or expansion overrides',async()=>{
  const css=await readFile(new URL('../app/research/research-pulse.module.css',import.meta.url),'utf8');
  assert.match(css,/\.item span\{white-space:normal\}/);
  assert.doesNotMatch(css,/ellipsis|line-clamp|data-expanded|white-space:nowrap/);
});
