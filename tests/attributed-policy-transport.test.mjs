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
import { officialPulseHeadlines } from '../lib/research/news-pulse-headline.ts';

const require = createRequire(import.meta.url);
const source = (await readFile(new URL('../app/research/news/news-story.tsx', import.meta.url), 'utf8'))
  .replace('import { additionalNewsDetail } from "@/lib/research/news-detail";', `import { additionalNewsDetail } from ${JSON.stringify(new URL('../lib/research/news-detail.ts', import.meta.url).href)};`)
  .replace('import styles from "./general-news.module.css";', 'const styles={story:"story",shortStory:"shortStory",tickers:"tickers",headline:"headline",note:"note",expand:"expand",body:"body",source:"source",srOnly:"srOnly"};');
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText
  .replace('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
const { default: NewsStory } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

// Exact actual source bytes/clocks; historical assessment/call rows are synthetic.
// Real old writer -> zero-call recovery -> server -> normalizer -> unchanged card.
const emitted = JSON.parse(execFileSync('python3', ['-c', String.raw`
import json,sys
sys.path[:0]=['scripts/research','tests']
import test_attributed_policy_publication as f
import test_attributed_policy_service as service
case=f.PolicyPublicationTests();case.setUp()
try:
    row=case.hold()
    assert case.recover()=='done'
    items=case.feed()
    with f.research.connect(case.path) as db:
        db.execute('DELETE FROM '+f.policy.AUDIT_TABLE)
    withdrawn=case.feed()
    scenarios=[service.replay(order,restart=True) for order in (['results','official'],['official','results'])]
    print(json.dumps({'items':items,'withdrawn':withdrawn,'copy':f.grammar.derive(f.BODY),'scenarios':scenarios}))
finally:case.doCleanups()
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
const raw={ok:true,enabled:false,items:[],resultBriefs:[],officialUpdates:emitted.items};
const item=availableNewsPayload(buildPublicNews(raw)).officialUpdates.find(value=>value.url===emitted.items[0].url);

for(const lang of ['ja','en']) {
  test(`policy title and all three attributed ${lang} facts survive real transport and card`,()=>{
    assert.ok(item);
    assert.deepEqual(item.tickers,[]);
    assert.equal(item.generalSource,1);
    assert.equal(item.newsCategory,'policy');
    assert.equal(item.publisher,'Reported economic news');
    const display=officialNewsDisplay(item,lang,[]);
    assert.equal(display.label,lang==='ja'?'政策ニュース':'Policy news');
    assert.ok(!/Company|企業|ECON|HASSETT|Hassett/.test(display.label));
    assert.equal(display.title,emitted.copy[lang==='ja'?'titleJa':'titleEn']);
    const expected=emitted.copy.facts.map(fact=>fact[lang]);
    assert.deepEqual(display.body.split('\n\n'),expected);
    assert.deepEqual(officialTime(item),{at:'2026-10-02T13:54:00.000Z',kind:'published'});
    assert.equal(item.observedAt,'2026-10-02T13:54:31.272+00:00');
    const html=renderToStaticMarkup(React.createElement(NewsStory,{...display,lang,publication:officialTime(item).at}));
    for(const fact of expected)assert.ok(html.includes(fact),fact);
    assert.equal((html.match(/class="headline(?: [^"]*)?"/g)||[]).length,1);
    assert.equal((html.match(/<summary>/g)||[]).length,1);
    assert.match(html,/<details/);
    const headlines=officialPulseHeadlines(item,lang,display.title);
    assert.equal(headlines[0],lang==='ja'?'ハセット氏、雇用報告はおおむね予想通りと発言':'Hassett: Jobs report was broadly as expected');
    assert.ok(headlines.every(text=>Array.from(text).reduce((size,char)=>size+(char.codePointAt(0)>255?2:1),0)<=96));
    assert.ok(headlines.every(text=>!/企業ニュース|company news/i.test(text)));
    // Without a short title the full headline is shown when it fits; the label stays as the narrow-screen fallback.
    const fallback=officialPulseHeadlines({...item,shortTitleJa:undefined,shortTitleEn:undefined},lang,display.title);
    assert.deepEqual(fallback,[display.title,lang==='ja'?'政策ニュース':'Policy news']);
    for(const privateValue of ['evidenceQuote','sourcePolicyDerivation','Private model copy','非公開のモデル'])assert.ok(!html.includes(privateValue));
  });

  test(`fresh real-service policy in either worker order preserves complete ${lang} card`,()=>{
    for(const scenario of emitted.scenarios){
      const source=scenario.collectedRaw[0];
      const feed=availableNewsPayload(buildPublicNews({ok:true,enabled:false,...scenario.public}));
      const matches=feed.officialUpdates.filter(value=>value.url===source.url);
      assert.equal(matches.length,1);assert.equal(feed.resultBriefs.filter(value=>value.url===source.url).length,0);
      assert.equal(scenario.final.callCount,1);assert.equal(scenario.final.apiReservationCount,1);
      assert.equal(scenario.final.rawUnchanged,true);
      const item=matches[0],display=officialNewsDisplay(item,lang,[]);
      assert.deepEqual(item.tickers,[]);assert.equal(item.newsCategory,'policy');
      assert.equal(display.label,lang==='ja'?'政策ニュース':'Policy news');
      assert.equal(Date.parse(item.publishedAt),Date.parse(source.published_at));
      assert.equal(item.observedAt,source.first_seen_at);
      assert.equal(display.title,emitted.copy[lang==='ja'?'titleJa':'titleEn']);
      assert.deepEqual(display.body.split('\n\n'),emitted.copy.facts.map(fact=>fact[lang]));
    }
  });
}

test('malformed classification cannot silently become company news or affect unrelated items',()=>{
  const valid=emitted.items[0];
  for(const change of [{newsCategory:'company'},{generalSource:2},{publisher:'Reported company news'},
    {url:'https://x.com/unknown/status/123'},{bodyEn:null},{translationJa:''},{researchId:'invented'},
    {syndication:{}},{tickers:['MSFT']},{tickers:['ECON']},{brief:{version:1,scope:'company',validFacts:1,pendingFacts:1}}]){
    const feed=availableNewsPayload({...raw,officialUpdates:[{...valid,...change}]});
    assert.deepEqual(feed.officialUpdates,[]);
  }
  const ordinary={...valid,newsCategory:undefined,publisher:'Reported company news',tickers:['MSFT']};
  assert.equal(officialNewsDisplay(ordinary,'en').label,'Company news · MSFT');
  const existingMacro={...valid,newsCategory:undefined,publisher:'Reported economic news'};
  assert.equal(officialNewsDisplay(existingMacro,'en').label,'Company news');
});

test('audit withdrawal removes policy from the actual public normalizer without stale cached body',()=>{
  const feed=availableNewsPayload(buildPublicNews({...raw,officialUpdates:emitted.withdrawn}));
  assert.ok(!feed.officialUpdates.some(value=>value.url===item.url));
});
