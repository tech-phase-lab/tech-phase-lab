import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { availableNewsPayload, publicNewsPayload } from '../lib/research/general-news.ts';
import { buildPublicNews } from '../lib/research/public-news-response.ts';
import { marketNewsBody, marketNewsDisplay } from '../lib/research/market-news-display.ts';
import { newsPulseItems } from '../lib/research/news-pulse-items.ts';
import { publishNews, newsSnapshot } from '../lib/research/news-snapshot.ts';

// Actual Python public projection over a temporary fixture DB. No live source,
// chart, provider, production DB or persisted publication mutation is used.
const snapshots = JSON.parse(execFileSync('python3', ['-c', String.raw`
import json,sys
sys.path.insert(0,'tests')
from test_treasury_period_detail import TreasuryPeriodDetailTests, FIXTURE, news
case=TreasuryPeriodDetailTests()
case.setUp()
try:
    result={'current':case.feed()}
    case.seed(FIXTURE['retainedText'].replace('10-year','15-year'))
    result['revisedBeforePublication']=case.feed()
    news.publish_direct_once(case.path,now=case.now)
    result['revised']=case.feed()
    case.db.execute('DELETE FROM x_market_publications')
    case.db.commit()
    result['withdrawn']=case.feed()
    print(json.dumps(result))
finally:
    case.doCleanups()
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }));
const current = snapshots.current[0];
const require = createRequire(import.meta.url);
const source = (await readFile(new URL('../app/research/news/news-story.tsx', import.meta.url), 'utf8'))
  .replace('import { additionalNewsDetail } from "@/lib/research/news-detail";',
    `import { additionalNewsDetail } from ${JSON.stringify(new URL('../lib/research/news-detail.ts', import.meta.url).href)};`)
  .replace('import styles from "./general-news.module.css";',
    'const styles={story:"story",shortStory:"shortStory",tickers:"tickers",headline:"headline",note:"note",expand:"expand",body:"body",srOnly:"srOnly"};');
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText
  .replace('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
const { default: NewsStory } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const feed = marketUpdates => ({ ok: true, enabled: false, items: [], marketUpdates });
const headlineOnly = item => {
  const result = { ...item };
  for (const key of ['detailPolicy', 'bodyJa', 'bodyEn']) delete result[key];
  return result;
};
const render = (item, lang) => renderToStaticMarkup(React.createElement(NewsStory, {
  ...marketNewsDisplay(item, lang), lang, publication: item.publishedAt, body: marketNewsBody(item, lang),
}));

test('Python current source detail survives server/client transport and the actual JA/EN lower renderer', () => {
  for (const expected of [current, snapshots.revised[0]]) {
    const raw = feed([expected]);
    const server = buildPublicNews(raw);
    const client = availableNewsPayload(server);
    assert.deepEqual(client.marketUpdates, raw.marketUpdates);
    assert.deepEqual(publicNewsPayload(client), client);
    const item = client.marketUpdates[0];
    const years = expected === current ? '10' : '15';
    assert.equal(item.titleJa, `米国債、${years}年間の成績が史上最悪に`);
    assert.equal(item.titleEn, `U.S. Treasuries suffer their worst ${years}-year period in history`);
    assert.equal(item.publishedAt, '2026-10-04T00:48:02Z');
    assert.equal(item.observedAt, '2026-10-04T00:49:10Z');
    for (const lang of ['ja', 'en']) {
      const before = structuredClone(item);
      const body = marketNewsBody(item, lang);
      const title = lang === 'ja' ? item.titleJa : item.titleEn;
      const html = render(item, lang);
      assert.match(html, /<details class="story"><summary>/);
      assert.doesNotMatch(html, /<details[^>]+open=/);
      assert.match(html, /aria-hidden="true">＋/);
      assert.ok(html.includes(lang === 'ja' ? '詳細を開閉' : 'Toggle details'));
      assert.equal(html.split(title).length - 1, 1);
      assert.equal(html.split(body).length - 1, 1);
      assert.ok(html.includes('Barchart'));
      assert.equal(html.split(item.publishedAt).length - 1, 1);
      assert.doesNotMatch(body, /−2%|-2%|Sep|15yr\+|BofA|annualized|total return|rolling|yield|利回り|ローリング|年率|利息|チャート/);
      assert.deepEqual(item, before);
      const [pulse] = newsPulseItems(raw, lang);
      const [oldPulse] = newsPulseItems(feed([headlineOnly(item)]), lang);
      for (const key of ['title', 'headlines', 'summary', 'shortTitle', 'at', 'kind']) assert.deepEqual(pulse[key], oldPulse[key]);
    }
  }
});

test('malformed, missing or mismatched optional detail never removes a valid headline', () => {
  const mutations = [
    { detailPolicy: undefined }, { detailPolicy: null }, { detailPolicy: [] },
    { detailPolicy: { version: 1 } }, { detailPolicy: 'treasury-performance-period-v2' },
    { bodyJa: undefined }, { bodyEn: undefined }, { bodyJa: null }, { bodyEn: ['PRIVATE'] },
    { bodyJa: `${current.bodyJa} 利回りは2%。` }, { bodyEn: `${current.bodyEn} Annualized return -2%.` },
    { bodyJa: current.bodyJa.replace('10', '15') }, { bodyEn: current.bodyEn.replace('10', '15') },
    { titleJa: current.titleJa.replace('10', '15') }, { titleEn: current.titleEn.replace('10', '15') },
    { topic: 'crude-oil' },
    { topic: 'index-membership', url: 'https://x.com/TrendSpider/status/123' },
  ];
  for (const mutation of mutations) {
    const malformed = { ...current, ...mutation };
    const raw = feed([malformed]);
    for (const parsed of [publicNewsPayload(raw), availableNewsPayload(raw), availableNewsPayload(buildPublicNews(raw))]) {
      assert.equal(parsed.marketUpdates.length, 1);
      assert.deepEqual(parsed.marketUpdates[0], headlineOnly(malformed));
      for (const lang of ['ja', 'en']) assert.doesNotMatch(render(parsed.marketUpdates[0], lang), /<details|<summary|＋/);
    }
    // Defensive rendering must not bypass the parser's optional contract.
    for (const lang of ['ja', 'en']) assert.equal(marketNewsBody(malformed, lang), undefined);
  }
  for (const url of ['https://x.com/Other/status/123', `${current.url}?s=20`, `${current.url}/photo/1`]) {
    const wrongAccount = { ...current, url };
    for (const lang of ['ja', 'en']) assert.equal(marketNewsBody(wrongAccount, lang), undefined);
  }
});

test('fresh revision and withdrawal replace old detail without a stale snapshot fallback', () => {
  for (const state of ['current', 'revisedBeforePublication', 'revised', 'withdrawn']) {
    const parsed = availableNewsPayload(buildPublicNews(feed(snapshots[state])));
    publishNews(parsed);
    assert.deepEqual(newsSnapshot().data.marketUpdates, snapshots[state]);
    if (state === 'revisedBeforePublication' || state === 'withdrawn') assert.deepEqual(parsed.marketUpdates, []);
    if (state === 'revised') {
      assert.notEqual(parsed.marketUpdates[0].id, current.id);
      assert.ok(parsed.marketUpdates[0].bodyJa.includes('15年間'));
      assert.ok(!JSON.stringify(parsed.marketUpdates).includes('10年'));
    }
  }
  publishNews(null);
});

test('unrelated headline-only market cards and existing company lower bodies are unchanged', () => {
  const unrelated = [
    { ...headlineOnly(current), id: '201', titleJa: '米国10年物国債利回りが再び急上昇中', titleEn: 'U.S. 10-Year Treasury Yield ripping again' },
    { ...headlineOnly(current), id: '202', topic: 'crude-oil', titleJa: '原油価格の速報', titleEn: 'Crude oil update' },
    { ...headlineOnly(current), id: '203', topic: 'index-membership', url: 'https://x.com/TrendSpider/status/203',
      titleJa: 'Nasdaq-100指数：追加予定 Moderna（$MRNA）、除外予定 Warner Bros Discovery（$WBD）。',
      titleEn: 'Nasdaq-100 index: Added (scheduled): Moderna $MRNA; Removed (scheduled): Warner Bros Discovery $WBD.' },
  ];
  const officialUpdates = [{ id: '204', title: 'Synthetic verified company headline', translationJa: '検証済み企業記事の見出し',
    url: 'https://developer.nvidia.com/blog/synthetic-fixture/', publisher: 'NVIDIA', tickers: ['NVDA'],
    publishedAt: current.publishedAt, observedAt: current.observedAt,
    bodyJa: '検証済み本文をそのまま保持する。', bodyEn: 'Preserve the verified body unchanged.' }];
  const prior = buildPublicNews({ ...feed([headlineOnly(current), ...unrelated]), officialUpdates });
  const after = buildPublicNews({ ...feed([current, ...unrelated]), officialUpdates });
  assert.deepEqual(after.officialUpdates, prior.officialUpdates);
  assert.equal(after.officialUpdates.find(item => item.id === '204').bodyJa, officialUpdates[0].bodyJa);
  assert.deepEqual(after.marketUpdates.slice(1), prior.marketUpdates.slice(1));
  for (const item of after.marketUpdates.slice(1)) for (const lang of ['ja', 'en']) {
    assert.equal(marketNewsBody(item, lang), undefined);
    assert.doesNotMatch(render(item, lang), /<details|<summary|＋|Barchart|TrendSpider/);
  }
});
