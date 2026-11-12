import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bandItems, bandParts, bandTitle } from '../lib/research/news-band.ts';

const require=createRequire(import.meta.url);
let source=await readFile(new URL('../app/research/research-pulse.tsx',import.meta.url),'utf8');
source=source.replace('import { newsSnapshot, serverNewsSnapshot, subscribeNews } from "@/lib/research/news-snapshot";',
  'const newsSnapshot = () => globalThis.__pulseTestSnapshot; const serverNewsSnapshot = newsSnapshot; const subscribeNews = () => () => {};');
source=source.replace('import { WATCH_TICKERS } from "@/lib/research/flash-rows";','const WATCH_TICKERS = new Set(["MU", "NVDA", "APH"]);');
for (const name of ['news-pulse-items','news-time','news-band','company-wire','wire-store','news-startup']) {
  source=source.replace(`"@/lib/research/${name}"`,JSON.stringify(new URL(`../lib/research/${name}.ts`,import.meta.url).href));
}
source=source.replace('const [wireSettled, setWireSettled] = useState(false);','const [wireSettled, setWireSettled] = useState(true);').replace('const [gaveUp, setGaveUp] = useState(false);','const [gaveUp, setGaveUp] = useState(true);');
source=source.replace('import styles from "./research-pulse.module.css";', 'const styles={pulse:"pulse",strip:"strip",item:"item",in:"in",out:"out",live:"live",hd:"hd",sym:"sym",tm:"tm",wave:"wave",flash:"flash",slot:"slot"};');
let compiled=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText;
for(const name of ['react','react/jsx-runtime']) compiled=compiled.replaceAll(JSON.stringify(name),JSON.stringify(pathToFileURL(require.resolve(name)).href));
const {default:ResearchPulse,fitFontSize}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));

const story=(id,ja,en='Headline',at='2026-10-03T13:34:30.000Z')=>({id,generalSource:1,tickers:['MU'],publisher:'Reported company news',url:`https://x.com/wallstengine/status/21063773530186${id}`,
  title:en,translationJa:ja,publishedAt:at,observedAt:at,bodyJa:`${ja}\n\n長い記事本文。`,bodyEn:`${en}\n\nLong article body.`,pulseTitleJa:ja,pulseTitleEn:en});

test('the band is one still line: LIVE, the short headline and the time, with no pause button and no tags',()=>{
  globalThis.__pulseTestSnapshot={data:{ok:true,enabled:false,items:[],officialUpdates:[story('1','MU、HBM需要で見通しを引き上げ','MU raises HBM outlook')]},checkedAt:Date.parse('2026-10-03T13:40:00Z')};
  for(const lang of ['ja','en']) {
    const html=renderToStaticMarkup(React.createElement(ResearchPulse,{lang}));
    assert.equal((html.match(/<button/g)??[]).length,0,'no pause button');
    assert.match(html,/class="live">LIVE</);
    assert.match(html,/class="hd"/);
    assert.match(html,/class="wave"/);
    assert.doesNotMatch(html,/class="marquee|class="scroll|aria-expanded|<details|長い記事本文|Long article body|NEW/);
    if(lang==='ja') { assert.match(html,/<b class="sym">MU<\/b>、HBM需要で見通しを引き上げ/); assert.match(html,/>10\/3 22:34</); }
    else assert.match(html,/>10\/3 09:34</);
    assert.match(html,/dateTime="2026-10-03T13:34:30.000Z"|datetime="2026-10-03T13:34:30.000Z"/);
  }
});

test('missing and failed feed snapshots render no stale or fabricated header news',()=>{
  for(const data of [null,{data:{ok:true,enabled:false,items:[]},checkedAt:0}]) {
    globalThis.__pulseTestSnapshot=data;
    assert.equal(renderToStaticMarkup(React.createElement(ResearchPulse,{lang:'ja'})),'');
  }
  delete globalThis.__pulseTestSnapshot;
});

test('a story without a short headline is left out and the band moves on; the same headline is never shown twice',()=>{
  const items=[
    {headlines:['アメリカの大手半導体メーカーが過去最高の売上高を発表しました本日'],title:'アメリカの大手半導体メーカーが過去最高の売上高を発表しました本日'},
    {headlines:['企業ニュース'],title:'企業ニュース'},
    {headlines:['APH、AI需要で通期見通しを引き上げ'],title:'長い見出しの全文がここにあります。'},
    {headlines:['APH、AI需要で通期見通しを引き上げ。'],title:'x'},
    {headlines:['MU、目標株価の引き上げ相次ぐ'],title:'y'},
  ];
  assert.deepEqual(bandItems(items,true).map(item=>item.band),['APH、AI需要で通期見通しを引き上げ','MU、目標株価の引き上げ相次ぐ']);
  assert.equal(bandTitle(['十二34567890123456789012345'],true),'', '25 characters is too long');
  assert.equal(bandTitle(['あ'.repeat(23)+'い'],true).length,24);
  assert.equal(bandTitle(['あ'.repeat(24)+'い'],true),'');
  assert.equal(bandTitle(['米10年債利回り、再び急上昇。'],true),'米10年債利回り、再び急上昇','no final 。');
});

test('stock symbols are bold monospace parts of the headline; other capitals are not',()=>{
  assert.deepEqual(bandParts('APH、AI需要でMUも上昇',['APH','MU']).filter(part=>part.symbol).map(part=>part.text),['APH','MU']);
});

test('the headline starts at 14.5px, shrinks 0.5px at a time to 12.5px, and only then is cut',()=>{
  assert.equal(fitFontSize(()=>true),14.5);
  assert.equal(fitFontSize(size=>size<=13.5),13.5);
  assert.equal(fitFontSize(size=>size<=12.5),12.5);
  assert.equal(fitFontSize(()=>false),12.5);
});

test('the band follows the owner design in its stylesheet',async()=>{
  const css=await readFile(new URL('../app/research/research-pulse.module.css',import.meta.url),'utf8');
  assert.match(css,/\.strip\{[^}]*height:56px/);
  assert.match(css,/\.live\{[^}]*background:#8ef0c4/);
  assert.match(css,/\.hd\{[^}]*font-size:14\.5px[^}]*white-space:nowrap[^}]*text-overflow:ellipsis/);
  assert.match(css,/\.tm\{[^}]*bottom:2px[^}]*10\.5px/);
  assert.match(css,/\.in\{animation:rise \.45s cubic-bezier\(\.3,\.7,\.2,1\)/);
  assert.match(css,/translateY\(16px\)/);
  assert.match(css,/animation:wave 3\.6s linear infinite/);
  assert.match(css,/35%\{opacity:1;height:2px/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\.in,\.out\{animation:none\}\.wave,\.flash\{animation:none\}\}/);
  assert.match(css,/\.pulse\{[^}]*margin:0 0 34px/, 'the band is 14px lower than before (20px to 34px)');
});

test("the band looks through a wide pool, so long company headlines at the top cannot empty it (Nov 5)", async () => {
  const source = await readFile(new URL("../app/research/research-pulse.tsx", import.meta.url), "utf8");
  assert.match(source, /const PULSE_POOL = 400/);
  assert.match(source, /newsPulseItems\(feed, lang, snapshot\.checkedAt, wire, PULSE_POOL\)/);
  assert.match(source, /writePulseCache\(lang, bandItems\(live, ja, 8, wide\)\)/);
});

test('a band headline that does not name its company gets the symbol in front; one that names it does not', async () => {
  const { bandLead } = await import('../lib/research/news-band.ts');
  const { japaneseNamesOf } = await import('../lib/research/stock-search.ts');
  assert.equal(bandLead('NVDA', '警察と活動家が衝突', japaneseNamesOf), 'NVDA');
  assert.equal(bandLead('NVDA', 'エヌビディアは強い四半期期待', japaneseNamesOf), '');
  assert.equal(bandLead('MU · NVDA', 'MUが増産へ', japaneseNamesOf), 'NVDA');
  assert.equal(bandLead('MKT', '原油が下落', japaneseNamesOf), '');
  assert.equal(bandLead('AAA · BBB · CCC', '値上げを発表'), 'AAA BBB');
  assert.equal(bandLead('NVDA', '警察と活動家が衝突'), 'NVDA');
});

test('on a wide screen the band prefers the fuller headline; on a phone it keeps the short one', async () => {
  const { bandItems } = await import('../lib/research/news-band.ts');
  const full = 'エヌビディア、次の四半期の売上高見通しが市場予想を上回る強い内容になると経営陣が説明';
  const items = [{ id: 'a', title: full, headlines: ['エヌビディアは強い四半期期待'] }];
  assert.equal(bandItems(items, true, 5, false)[0].band, 'エヌビディアは強い四半期期待');
  assert.equal(bandItems(items, true, 5, true)[0].band, full);
  assert.equal(bandItems([{ id: 'b', title: full + full, headlines: ['短い見出し'] }], true, 5, true)[0].band, '短い見出し');
});
