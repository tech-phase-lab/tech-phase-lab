import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildPublicNews } from '../lib/research/public-news-response.ts';
import { availableNewsPayload } from '../lib/research/general-news.ts';
import { officialNewsDisplay } from '../lib/research/news-presentation.ts';
import { officialTime } from '../lib/research/news-time.ts';
import { officialPulseHeadlines, fitPulseHeadline } from '../lib/research/news-pulse-headline.ts';
import { newsPulseItems } from '../lib/research/news-pulse-items.ts';

const require = createRequire(import.meta.url);
const source = (await readFile(new URL('../app/research/news/news-story.tsx', import.meta.url), 'utf8'))
  .replace('import { additionalNewsDetail } from "@/lib/research/news-detail";', `import { additionalNewsDetail } from ${JSON.stringify(new URL('../lib/research/news-detail.ts', import.meta.url).href)};`)
  .replace('import styles from "./general-news.module.css";', 'const styles={story:"story",shortStory:"shortStory",tickers:"tickers",headline:"headline",note:"note",expand:"expand",body:"body",source:"source",srOnly:"srOnly"};');
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText
  .replace('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
const { default: NewsStory } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

// Existing minimal synthetic reports. Actual offline collector -> real worker
// -> audited publication -> server -> browser normalizer -> unchanged card.
const emitted = JSON.parse(execFileSync('python3', ['-c', String.raw`
import json,sys
sys.path[:0]=['scripts/research','tests']
import test_macro_fresh_service as service
import test_macro_source_publication as f
output=[]
for body in (service.JOBS,service.CPI):
    case=f.MacroPublicationTests();case.setUp()
    try:
        row=case.hold(body)
        assert case.recover()=='done'
        held=case.feed()
        case.mutate('DELETE FROM '+f.macro.AUDIT_TABLE)
        withdrawn=case.feed()
    finally:case.doCleanups()
    output.append({'copy':service.parser.derive(body),'held':held,'withdrawn':withdrawn,
        'scenarios':[service.replay(body,order,restart=True) for order in (['official','results'],['results','official'])]})
print(json.dumps(output))
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
const raw = officialUpdates => ({ok:true,enabled:false,items:[],resultBriefs:[],officialUpdates});
const normalize = value => availableNewsPayload(buildPublicNews(value));
const originals = emitted.map(value=>value.held[0]);

for (const lang of ['ja','en']) {
  test(`typed macro category, full ${lang} copy and source clocks survive collector and card`, () => {
    for (const value of emitted) for (const scenario of value.scenarios) {
      const before = JSON.stringify(scenario);
      const source = scenario.collectedRaw[0];
      const feed = normalize({ok:true,enabled:false,...scenario.public});
      const matching = feed.officialUpdates.filter(item=>item.url===source.url);
      assert.equal(matching.length,1);
      assert.deepEqual(feed.resultBriefs.filter(item=>item.url===source.url),[]);
      assert.deepEqual(scenario.final,{rawUnchanged:true,callCount:1,apiReservationCount:1});
      const item=matching[0], display=officialNewsDisplay(item,lang,[]);
      assert.deepEqual(item.tickers,[]);
      assert.equal(item.generalSource,1);
      assert.equal(item.newsCategory,'economic');
      assert.equal(item.publisher,'Reported economic news');
      assert.equal(display.label,lang==='ja'?'経済ニュース':'Economic news');
      assert.equal(display.title,value.copy[lang==='ja'?'titleJa':'titleEn']);
      assert.equal(display.body,value.copy[lang==='ja'?'bodyJa':'bodyEn'].split('\n').join('\n\n'));
      assert.equal(Date.parse(item.publishedAt),Date.parse(source.published_at));
      assert.equal(item.observedAt,source.first_seen_at);
      assert.deepEqual(officialTime(item),{at:new Date(source.published_at).toISOString(),kind:'published'});
      const html=renderToStaticMarkup(React.createElement(NewsStory,{...display,lang,publication:officialTime(item).at}));
      for (const paragraph of display.body.split('\n\n')) assert.ok(html.includes(paragraph),paragraph);
      assert.equal((html.match(/class="headline"/g)||[]).length,1);
      assert.equal((html.match(/<summary>/g)||[]).length,1);
      assert.match(html,/<details/);
      for (const privateValue of ['evidenceQuote','sourceMacroDerivation','Never publish model wording','モデルのコピー']) assert.ok(!html.includes(privateValue));
      const pulse=newsPulseItems({...feed,officialUpdates:[item]},lang).find(value=>value.url===item.url);
      assert.ok(pulse.body.includes(display.body));
      assert.equal(pulse.ticker,display.label);
      assert.equal(pulse.at,item.publishedAt);
      assert.ok(!pulse.headlines.some(text=>/Company|企業|ECON|forecast|予想/.test(text)));
      assert.equal(JSON.stringify(scenario),before);
    }
  });
}

// Same conservative font/space budgets as the existing one-row header tests.
// This is fit-selection evidence, not a browser/device or live-mobile claim.
const measure=text=>Array.from(text).reduce((width,char)=>width+(char.codePointAt(0)>255?12:7),0);
const viewportBudget=width=>Math.min(width-40,width>=768?width-228:width)-22-16-28-(width<=600?70:100);
test('whole macro alternatives fit representative 320/375/390/768/932/1440 budgets',()=>{
  const expected={ja:['米8月非農業部門雇用+31,000人','報道：ユーロ圏8月CPI 前年比3.9%'],en:['U.S. Aug nonfarm payrolls +31K','Reported Eurozone Aug CPI: 3.9% YoY']};
  for(const lang of ['ja','en']) for(const [index,rawItem] of originals.entries()) {
    const item=normalize(raw([rawItem])).officialUpdates.find(value=>value.url===rawItem.url);
    const display=officialNewsDisplay(item,lang);
    const headlines=officialPulseHeadlines(item,lang,display.title);
    assert.equal(headlines[0],expected[lang][index]);
    if(index===1)for(const headline of headlines.filter(text=>text.includes('%'))) {
      assert.ok(headline.startsWith(lang==='ja'?'報道：':'Reported '));
      assert.ok(headline.includes(lang==='ja'?'前年比':'YoY'));
    }
    assert.ok(headlines.every(text=>Array.from(text).reduce((n,c)=>n+(c.codePointAt(0)>255?2:1),0)<=64));
    for(const viewport of [320,375,390,768,932,1440]) {
      const selected=fitPulseHeadline(headlines,viewportBudget(viewport),measure);
      assert.ok(selected,`${lang} ${viewport}`);
      assert.ok(headlines.includes(selected));
      assert.ok(measure(selected)<=viewportBudget(viewport));
      assert.doesNotMatch(selected,/\n|…|\.\.\.|forecast|estimate|予想|95K|3\.8%/);
      if(viewport>=768)assert.equal(selected,expected[lang][index]);
    }
  }
});

test('economic classification requires the strict complete source-news envelope',()=>{
  const valid=originals[0], unrelated={...valid,id:'999',url:'https://x.com/wallstengine/status/999',newsCategory:undefined};
  for(const change of [{newsCategory:'company'},{newsCategory:null},{generalSource:2},{generalSource:undefined},
    {publisher:'Reported company news'},{url:'https://x.com/unknown/status/123'},
    {url:valid.url+'?copy=1'},{bodyJa:null},{bodyEn:null},{translationJa:''},{researchId:'invented'},
    {syndication:{}},{sources:[]},{tickers:['MSFT']},{tickers:['ECON']},
    {brief:{version:1,scope:'sector',validFacts:1,pendingFacts:1}}]) {
    const feed=availableNewsPayload(raw([{...valid,...change},unrelated]));
    assert.deepEqual(feed.officialUpdates.map(item=>item.id),['999']);
  }
});

test('publisher text alone and absent classification preserve the accepted old display',()=>{
  for(const item of originals) for(const lang of ['ja','en']) {
    const old={...item};delete old.newsCategory;delete old.shortTitleJa;delete old.shortTitleEn;
    const accepted=availableNewsPayload(raw([old])).officialUpdates[0];
    assert.equal(accepted.newsCategory,undefined);
    assert.equal(accepted.generalSource,undefined);
    const display=officialNewsDisplay(accepted,lang);
    assert.equal(display.label,lang==='ja'?'企業ニュース':'Company news');
    assert.equal(display.title,lang==='ja'?old.translationJa:old.title);
    assert.equal(display.body,lang==='ja'?old.bodyJa:old.bodyEn);
    assert.equal(officialPulseHeadlines(accepted,lang,display.title).at(-1),lang==='ja'?'企業ニュース':'Company news');
    const company={...accepted,tickers:['MSFT']};
    assert.equal(officialNewsDisplay(company,lang).label,lang==='ja'?'企業ニュース · MSFT':'Company news · MSFT');
    const legacyIndicator={...accepted,tickers:['ECON']};
    assert.equal(officialNewsDisplay(legacyIndicator,lang).label,lang==='ja'?'経済指標':'Economic indicators');
  }
});

test('source audit withdrawal removes category, body and pulse together without stale copy',()=>{
  for(const value of emitted) {
    const before=normalize(raw(value.held));
    const item=before.officialUpdates.find(item=>item.url===value.held[0].url);
    assert.equal(item.newsCategory,'economic');
    const after=normalize(raw(value.withdrawn));
    assert.ok(!after.officialUpdates.some(value=>value.url===item.url));
    for(const lang of ['ja','en'])assert.ok(!newsPulseItems(after,lang).some(value=>value.url===item.url));
  }
});
