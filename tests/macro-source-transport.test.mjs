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

// Real isolated audit writer -> public reader -> server -> browser -> card.
// Source numbers are synthetic; production data and credentials are not used.
const emitted = JSON.parse(execFileSync('python3', ['-c', String.raw`
import json,sys
sys.path[:0]=['scripts/research','tests']
from test_macro_source_publication import MacroPublicationTests, NOW, JOBS, CPI
import official_research as research
import macro_source_publication as macro
case=MacroPublicationTests();case.setUp()
try:
    row=case.hold(JOBS,number=901)
    assert case.recover()=='done'
    case.hold(CPI,number=902)
    assert case.recover()=='done'
    original=case.feed()
    with research.connect(case.path) as db:
        db.execute('DELETE FROM '+macro.AUDIT_TABLE+' WHERE event_id=?',(row['id'],))
    withdrawn=case.feed()
    print(json.dumps({'items':original,'withdrawn':withdrawn}))
finally:case.doCleanups()
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));

const raw = { ok: true, enabled: false, items: [], resultBriefs: [], officialUpdates: emitted.items };
const built = buildPublicNews(raw);
const client = availableNewsPayload(built);
const itemFor = word => client.officialUpdates.find(item => item.title.includes(word));
const jobs = itemFor('nonfarm');
const cpi = itemFor('Eurozone');

for (const lang of ['ja', 'en']) {
  test(`all seven audited jobs rows survive server/browser and real ${lang} NewsStory`, () => {
    assert.ok(jobs);
    const display = officialNewsDisplay(jobs, lang, client.resultBriefs);
    const expected = lang === 'ja'
      ? ['非農業部門雇用者数：実績 +31,000人、予想 +95,000人。', '失業率：実績 4.3%、予想 4.0%。',
         '平均時給（前年比）：実績 3.3%、予想 3.4%。', '労働参加率：実績 62.1%、予想 62.0%。',
         '民間雇用者数：実績 +48,000人、予想 +83,000人。', '平均週間労働時間：実績 34.6時間、予想 34.5時間。',
         '政府部門雇用者数：実績 -17,000人、前回 +45,000人。']
      : ['Nonfarm payrolls: actual +31K; estimate +95K.', 'Unemployment rate: actual 4.3%; estimate 4.0%.',
         'Average hourly earnings (YoY): actual 3.3%; estimate 3.4%.', 'Labor force participation rate: actual 62.1%; estimate 62.0%.',
         'Private payrolls: actual +48K; estimate +83K.', 'Average workweek: actual 34.6 hours; estimate 34.5 hours.',
         'Government payrolls: actual -17K; prior +45K.'];
    const publication = officialTime(jobs);
    assert.deepEqual(publication, { at: '2026-10-01T08:00:00.000Z', kind: 'published' });
    assert.deepEqual(jobs.tickers, []);
    assert.ok(!display.label.includes('ECON'));
    assert.equal(display.body.split('\n\n').length, 8);
    assert.equal(display.title, lang === 'ja' ? '米8月雇用統計：非農業部門雇用者数+31,000人' : 'U.S. August nonfarm payrolls +31K');
    const html = renderToStaticMarkup(React.createElement(NewsStory, { ...display, lang, publication: publication.at }));
    for (const text of expected) {
      assert.ok(display.body.includes(text), text);
      assert.ok(html.includes(text), text);
    }
    assert.match(html, /<details/);
    assert.equal(officialPulseHeadlines(jobs, lang, display.title)[0], display.title);
  });

  test(`all three CPI metrics/comparisons survive real ${lang} NewsStory`, () => {
    const display = officialNewsDisplay(cpi, lang, client.resultBriefs);
    const html = renderToStaticMarkup(React.createElement(NewsStory, { ...display, lang, publication: officialTime(cpi).at }));
    const expected = lang === 'ja'
      ? ['前年同月比3.9%', '予想 3.8%、前回 3.4%', '2022年6月以来の最高水準', 'コアCPIは2.6%', 'サービスのインフレ率は3.4%']
      : ['3.9% year-over-year', 'estimate of 3.8% and a prior reading of 3.4%', 'highest reading since June 2022', 'core CPI at 2.6%', 'services inflation at 3.4%'];
    for (const text of expected) assert.ok(html.includes(text), text);
    assert.equal(display.body.split('\n\n').length, 2);
    assert.match(display.title, /3\.9%/);
    assert.match(html, /<details/);
  });
}

test('audit removal withdraws the actual transported item without cached model copy', () => {
  const after = availableNewsPayload(buildPublicNews({ ...raw, officialUpdates: emitted.withdrawn }));
  assert.ok(!after.officialUpdates.some(item => item.url === jobs.url));
  assert.ok(after.officialUpdates.some(item => item.url === cpi.url));
  assert.ok(!JSON.stringify(client).includes('Model wording'));
});

test('card styles retain the verified metric row paragraph boundaries', async () => {
  const css = await readFile(new URL('../app/research/news/general-news.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.body\{[^}]*white-space:pre-wrap/);
});

const freshScenarios = JSON.parse(execFileSync('python3', ['-c', String.raw`
import json,sys
sys.path[:0]=['scripts/research','tests']
import test_macro_fresh_service as fixture
print(json.dumps([fixture.replay(body,order,restart=True) for body in (fixture.JOBS,fixture.CPI)
 for order in (['results','official'],['official','results'])]))
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));

for (const lang of ['ja', 'en']) {
  test(`real collector and both worker orders retain complete ${lang} cards after restart`, () => {
    for (const scenario of freshScenarios) {
      const raw = scenario.collectedRaw[0];
      const built = buildPublicNews({ ok: true, enabled: false, ...scenario.public });
      const client = availableNewsPayload(built);
      const matches = client.officialUpdates.filter(item => item.url === raw.url);
      assert.equal(matches.length, 1);
      assert.equal(client.resultBriefs.filter(item => item.url === raw.url).length, 0);
      const item = matches[0];
      assert.deepEqual(item.tickers, []);
      assert.equal(Date.parse(item.publishedAt), Date.parse(raw.published_at));
      assert.equal(Date.parse(item.observedAt), Date.parse(raw.first_seen_at));
      assert.equal(scenario.final.callCount, 1);
      assert.equal(scenario.final.apiReservationCount, 1);
      assert.equal(scenario.final.rawUnchanged, true);
      const display = officialNewsDisplay(item, lang, client.resultBriefs);
      const html = renderToStaticMarkup(React.createElement(NewsStory, { ...display, lang, publication: officialTime(item).at }));
      const paragraphs = display.body.split('\n\n');
      assert.equal(paragraphs.length, scenario.format === 'jobs' ? 8 : 2);
      for (const paragraph of paragraphs) assert.ok(html.includes(paragraph), paragraph);
      assert.equal(officialPulseHeadlines(item, lang, display.title)[0], display.title);
      assert.ok(!display.body.includes('Never publish model wording'));
      assert.ok(!display.body.includes('モデルのコピーを公開しない'));
    }
  });
}
