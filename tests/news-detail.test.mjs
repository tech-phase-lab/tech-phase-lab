import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { additionalNewsDetail } from '../lib/research/news-detail.ts';
import { marketNewsBody, marketNewsDisplay } from '../lib/research/market-news-display.ts';
import { officialNewsDisplay } from '../lib/research/news-presentation.ts';
import { resultFactText, resultNewsUpdate, mergeResultNews } from '../lib/research/result-news.ts';
import { parseResultBriefs } from '../lib/research/market-results.ts';
import { availableNewsPayload, publicNewsPayload } from '../lib/research/general-news.ts';
import { publishNews, newsSnapshot } from '../lib/research/news-snapshot.ts';
import { buildPublicNews } from '../lib/research/public-news-response.ts';

const require=createRequire(import.meta.url);
const source=(await readFile(new URL('../app/research/news/news-story.tsx',import.meta.url),'utf8'))
  .replace('import { additionalNewsDetail } from "@/lib/research/news-detail";', `import { additionalNewsDetail } from ${JSON.stringify(new URL('../lib/research/news-detail.ts', import.meta.url).href)};`)
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

test('brief rendering has one headline and no source row, fake disclosure or badge',()=>{
  const html=renderToStaticMarkup(React.createElement(NewsStory,{...props,body:marketNewsBody(bond,'ja')}));
  assert.equal(html.split(props.title).length-1,1);
  assert.doesNotMatch(html,/<details|<summary|＋|短報|4\.32%|basis points/);
  assert.doesNotMatch(html, /Barchart|原文|Source|href=/);
});

test('JA and EN index and Treasury cards keep their headline without source links or a plus',()=>{
  const index={topic:'index-membership',titleJa:'Nasdaq-100指数：追加予定 Moderna（$MRNA）、除外予定 Warner Bros Discovery（$WBD）。',
    titleEn:'Moderna will join the Nasdaq-100 index, replacing Warner Bros Discovery.'};
  for(const update of [index,bond]) for(const lang of ['ja','en']) {
    const display=marketNewsDisplay(update,lang);
    const source=update===index ? {publisher:'TrendSpider',url:'https://x.com/TrendSpider/status/777'} : props.source;
    const html=renderToStaticMarkup(React.createElement(NewsStory,{...props,...display,lang,source,body:marketNewsBody(update,lang)}));
    assert.equal(html.split(display.title).length-1,1);
    assert.doesNotMatch(html,/<details|<summary|＋/);
    assert.ok(!html.includes(source.url));
    assert.doesNotMatch(html, /Barchart|TrendSpider|原文|Source|href=/);
  }
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
    assert.doesNotMatch(html, /Barchart|原文|Source|href=/);
  }
});

test('verified partial briefs show review status without a duplicate headline or artificial disclosure',()=>{
  const item={id:'8044',title:'Broker industry outlook (brief; details awaiting review)',translationJa:'証券会社による業界見通し（短報・詳細確認中）',
    url:'https://x.com/wallstengine/status/8044',publisher:'Reported industry news',tickers:[],
    generalSource:1,brief:{version:1,scope:'sector',validFacts:1,pendingFacts:1},
    observedAt:'2026-10-02T12:49:12.663Z',bodyJa:'証券会社による業界見通し',bodyEn:'Broker industry outlook'};
  const approved=publicNewsPayload({ok:true,enabled:false,items:[],officialUpdates:[item]}).officialUpdates[0];
  for(const lang of ['ja','en']) {
    for(const row of [approved,{...approved,bodyJa:item.translationJa,bodyEn:item.title}]) {
      const display=officialNewsDisplay(row,lang);
      const html=renderToStaticMarkup(React.createElement(NewsStory,{...props,...display,lang}));
      assert.equal(display.body,undefined);
      assert.equal(html.split(display.title).length-1,1);
      assert.ok(html.includes(lang==='ja'?'業界短報 · 詳細は確認中':'Industry brief · Details awaiting review'));
      assert.equal((html.match(/details awaiting review|詳細は確認中/gi)??[]).length,1);
      assert.doesNotMatch(html,/<details|<summary|＋|\bMU\b|Micron|マイクロン|\(brief;|（短報・詳細確認中）/);
    }
    const detail=lang==='ja'?'新規設備の準備には時間がかかる。':'Preparing new facilities takes time.';
    const withDetail=officialNewsDisplay({...approved,[lang==='ja'?'bodyJa':'bodyEn']:detail},lang);
    const expanded=renderToStaticMarkup(React.createElement(NewsStory,{...props,...withDetail,lang}));
    assert.match(expanded,/<details class="story"><summary>/);
    assert.equal(expanded.split(detail).length-1,1);
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


test('merged news hides source labels while preserving differing supported facts and retained provenance', () => {
  const other={...jobs,id:'1177',researchId:'x-result-1177',url:'https://x.com/tipranks/status/778',publisher:'TipRanks',
    facts:[{...jobs.facts[0],comparisons:{forecast:'+85K'}}]};
  const briefs=parseResultBriefs([jobs,other]);
  const [merged]=mergeResultNews(briefs.map(resultNewsUpdate),briefs);
  const before=JSON.stringify(merged);
  for(const lang of ['ja','en']) {
    const display=officialNewsDisplay(merged,lang);
    const html=renderToStaticMarkup(React.createElement(NewsStory,{...props,...display,lang}));
    assert.match(html,/\+90K/);
    assert.match(html,/\+85K/);
    assert.doesNotMatch(html,/Wall St Engine|TipRanks|x\.com|原文|href=/);
    assert.match(html,/<details/);
  }
  assert.equal(JSON.stringify(merged),before);
  assert.equal(merged.sources.length,2);
});


test('the live jobs-shaped numeric card shows actual and forecast once without a disclosure', () => {
  // Captured visible title/body shape. Other facts have no retained comparisons.
  const [brief] = parseResultBriefs([{...jobs, facts:jobs.facts.map(fact => ({...fact,
    comparisons:fact.key === 'unemployment-rate' ? {forecast:'4.1%'} : undefined}))}]);
  const update = resultNewsUpdate(brief), before = JSON.stringify(update);
  for (const lang of ['ja','en']) {
    const display = officialNewsDisplay(update,lang,[brief]);
    const html = renderToStaticMarkup(React.createElement(NewsStory,{...props,...display,lang}));
    assert.equal(display.body,undefined);
    assert.doesNotMatch(html,/<details|<summary|＋/);
    for (const number of ['+29K','4.2%','4.1%','3.0%']) assert.equal(html.split(number).length-1,1);
    assert.ok(display.title.includes(lang === 'ja' ? '失業率 4.2%（予想 4.1%）' : 'Unemployment rate 4.2% (Forecast 4.1%)'));
  }
  assert.equal(JSON.stringify(update),before);
});

test('inline comparisons are generic, source-bound, idempotent and never choose a conflicting forecast', () => {
  const [brief] = parseResultBriefs([jobs]);
  const update = resultNewsUpdate(brief);
  for (const lang of ['ja','en']) {
    const display = officialNewsDisplay(update,lang,[brief]);
    assert.equal(display.body,undefined);
    for(const number of ['+90K','4.1%','3.1%']) assert.ok(display.title.includes(number));
    const repeated = officialNewsDisplay({...update,title:display.title,translationJa:display.title},lang,[brief]);
    assert.equal(repeated.title,display.title);
    const unrelated = officialNewsDisplay(update,lang,[{...brief,id:'999'}]);
    assert.equal(unrelated.title,lang === 'ja' ? jobs.titleJa : jobs.titleEn);
    assert.ok(unrelated.body.includes('+90K'));
  }
  const [other] = parseResultBriefs([{...jobs,id:'1177',researchId:'x-result-1177',url:'https://x.com/TipRanks/status/778',publisher:'TipRanks',
    facts:[{...jobs.facts[0],comparisons:{forecast:'+85K'}}]}]);
  const briefs=[brief,other], [merged]=mergeResultNews(briefs.map(resultNewsUpdate),briefs);
  for(const lang of ['ja','en']) {
    const display=officialNewsDisplay(merged,lang,briefs);
    assert.ok(display.body.includes('+90K'));
    assert.ok(display.body.includes('+85K'));
    assert.ok(!display.title.includes('+90K'));
    assert.ok(!display.title.includes('+85K'));
  }
});

test('final disclosure guard compares every visible field and preserves real article prose', () => {
  const html=renderToStaticMarkup(React.createElement(NewsStory,{...props,body:[props.label,props.title,props.publication].join('\n')}));
  assert.doesNotMatch(html,/<details|<summary|＋/);
  const body='DGX Spark uses unified memory and integrated networking.\n\nThe verified performance test used two connected systems.';
  const article=renderToStaticMarkup(React.createElement(NewsStory,{...props,title:'NVIDIA introduces DGX Spark',body}));
  assert.match(article,/<details/);
  assert.ok(article.includes('The verified performance test used two connected systems.'));
});


test('inline comparisons never attach to a longer population or basis label', () => {
  const [brief] = parseResultBriefs([{...jobs,facts:[jobs.facts[1]]}]);
  const update = {...resultNewsUpdate(brief),title:'Youth unemployment rate 4.2%',translationJa:'若年失業率 4.2%'};
  for(const lang of ['ja','en']) {
    const display=officialNewsDisplay(update,lang,[brief]);
    assert.equal(display.title,lang === 'ja' ? update.translationJa : update.title);
    assert.ok(display.body.includes('4.1%'));
    assert.ok(display.body.includes('4.2%'));
  }
});


test('numeric fact dedupe keeps population and value boundaries even when forecasts are already visible', () => {
  assert.equal(additionalNewsDetail('Youth unemployment rate 4.2% (Forecast 4.1%)','Unemployment rate: 4.2% (Forecast 4.1%)'), 'Unemployment rate: 4.2% (Forecast 4.1%)');
  assert.equal(additionalNewsDetail('若年失業率 4.2%（予想4.1%）','失業率：4.2%（予想4.1%）'), '失業率：4.2%（予想4.1%）');
  assert.equal(additionalNewsDetail('Revenue 1000','Revenue: 100'), 'Revenue: 100');
  assert.equal(additionalNewsDetail('Revenue 100B','Revenue: 100'), 'Revenue: 100');
  assert.equal(additionalNewsDetail('NFP +29K; Unemployment rate 4.2% (Forecast 4.1%; Previous 4.0%)','Unemployment rate: 4.2% (Forecast 4.1%; Previous 4.0%)'), undefined);
});

test('a forecast shown for a different population does not satisfy the matched actual clause', () => {
  const [brief] = parseResultBriefs([{...jobs,facts:[jobs.facts[1]]}]);
  const update = {...resultNewsUpdate(brief),title:'Unemployment rate 4.2%; Youth unemployment rate 4.2% (Forecast 4.1%)',
    translationJa:'失業率 4.2%／若年失業率 4.2%（予想 4.1%）'};
  for(const lang of ['ja','en']) {
    const display=officialNewsDisplay(update,lang,[brief]);
    assert.ok(display.title.startsWith(lang === 'ja' ? '失業率 4.2%（予想 4.1%）／若年' : 'Unemployment rate 4.2% (Forecast 4.1%); Youth'));
    assert.equal(display.body,undefined);
  }
});


test('current inline publications beyond twenty retain exact approved bodies and real disclosure',async()=>{
  // Use the actual Python service over 25 synthetic saved publications. There
  // are no model calls, remote requests or private/production database reads.
  const snapshots=JSON.parse(execFileSync('python3',['-c',`
import json, sys
sys.path.insert(0, 'tests')
from test_official_news_projection import OfficialNewsProjectionTests, research
case = OfficialNewsProjectionTests()
case.setUp()
try:
    snapshots = {'before': case.public(), 'olderId': str(case.older['id'])}
    with research.connect(case.path) as db:
        db.execute('DELETE FROM official_research_publications WHERE event_id=?', (case.older['id'],))
    snapshots['withdrawn'] = case.public()
    with research.connect(case.path) as db:
        db.execute("UPDATE sources SET status='held' WHERE url=?", (case.older['url'],))
    snapshots['held'] = case.public()
    print(json.dumps(snapshots))
finally:
    case.doCleanups()
  `],{cwd:new URL('..',import.meta.url),encoding:'utf8'}));
  const raw=snapshots.before;
  assert.equal(raw.officialResearch.length,20);
  assert.equal(raw.officialUpdates.length,25);
  const legacy=structuredClone(raw);
  for(const item of legacy.officialUpdates) {delete item.bodyJa;delete item.bodyEn;}
  const before=buildPublicNews(legacy),after=buildPublicNews(raw);
  const cappedIds=new Set(raw.officialResearch.map(note=>note.id.replace('ir-result-','')));
  assert.equal(cappedIds.size,20);
  let restored=0;
  for(const expected of raw.officialUpdates) {
    const item=after.officialUpdates.find(item=>item.id===expected.id);
    const prior=before.officialUpdates.find(item=>item.id===expected.id);
    assert.equal(item.bodyJa,expected.bodyJa);
    assert.equal(item.bodyEn,expected.bodyEn);
    if(cappedIds.has(item.id)) assert.deepEqual(item,prior);
    else {
      restored++;
      assert.equal(prior.bodyJa,undefined);
      assert.equal(prior.bodyEn,undefined);
      const metadata={...item};
      delete metadata.bodyJa;
      delete metadata.bodyEn;
      assert.deepEqual(metadata,prior);
    }
    for(const lang of ['ja','en']) {
      const display=officialNewsDisplay(item,lang);
      assert.ok(display.body);
      assert.ok(display.body.includes(lang==='ja'?'技術とチームがToken Factoryに加わった。':'The technology and team joined Token Factory.'));
      const html=renderToStaticMarkup(React.createElement(NewsStory,{...props,...display,lang,source:{publisher:item.publisher,url:item.url}}));
      assert.match(html,/<details class="story"><summary>/);
      assert.match(html,/aria-hidden="true">＋/);
    }
  }
  assert.equal(restored,5);
  const panel=await readFile(new URL('../app/research/news/general-news-panel.tsx',import.meta.url),'utf8');
  const pageLogic=panel.slice(panel.indexOf('  const official ='),panel.indexOf('  const format ='));
  const pagination=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(
    `import { officialTime } from ${JSON.stringify(new URL('../lib/research/news-time.ts',import.meta.url).href)};
`
    +`export function visible(data,page,officialOnly=false) { ${pageLogic}
return {pages,current,visibleUpdates,visibleNews}; }`)).toString('base64'));
  const pages=pagination.visible(after,1).pages;
  assert.equal(pages,pagination.visible(before,1).pages);
  const visited=[];
  let restoredPage=0;
  for(let page=1;page<=pages;page++) {
    const current=pagination.visible(after,page);
    assert.ok(current.visibleUpdates.length<=5);
    assert.deepEqual(current.visibleUpdates.map(row=>row.item.id),pagination.visible(before,page).visibleUpdates.map(row=>row.item.id));
    visited.push(...current.visibleUpdates.map(row=>row.item.id));
    if(current.visibleUpdates.some(row=>row.item.id===snapshots.olderId)) restoredPage=page;
  }
  assert.ok(restoredPage>4);
  assert.deepEqual(visited,after.officialUpdates.map(item=>item.id));
  // Replay subsequent withdrawal/hold through the normal client parser and
  // the actual remount seed-selection helper: the old body never resurfaces.
  const helpers=panel.slice(panel.indexOf('let snapshot:'),panel.indexOf('export default function'));
  const remount=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(helpers+
    '\nexport { initialSnapshot }; export function seed(cache) { snapshot=cache; lastFailedAt=0; }')).toString('base64'));
  const now=Date.now(),initial={data:after,checkedAt:now-1000};
  for(const state of ['withdrawn','held']) {
    const fresh=availableNewsPayload(buildPublicNews(snapshots[state]));
    const matching=fresh.officialUpdates.find(item=>item.id===snapshots.olderId);
    if(state==='withdrawn') {
      assert.ok(matching);
      assert.equal(matching.bodyJa,undefined);
      assert.equal(matching.bodyEn,undefined);
    } else assert.equal(matching,undefined);
    publishNews(fresh);
    remount.seed({data:fresh,time:now,at:new Date(now).toISOString()});
    assert.deepEqual(newsSnapshot().data,fresh);
    assert.deepEqual(remount.initialSnapshot(initial).data,fresh);
    assert.deepEqual(remount.initialSnapshot().data,fresh);
  }
  publishNews(null);

  assert.deepEqual(after.officialHistory,before.officialHistory);
  for(const note of raw.officialResearch) {
    assert.ok(!JSON.stringify(after).includes(note.purpose.ja));
    assert.ok(!JSON.stringify(after).includes(note.purpose.en));
  }
  assert.doesNotMatch(JSON.stringify(after),/evidenceQuote|Company announcement background/);
});
