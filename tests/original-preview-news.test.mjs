import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { availableNewsPayload, publicNewsPayload, boundedOfficialHistory } from '../lib/research/general-news.ts';
import { buildPublicNews } from '../lib/research/public-news-response.ts';
import { parseOriginalPreviewItems } from '../lib/research/original-preview-news.ts';
import { newsPulseItems } from '../lib/research/news-pulse-items.ts';
import { publishNews, newsSnapshot } from '../lib/research/news-snapshot.ts';

const require = createRequire(import.meta.url);
const base = new URL('../app/research/news/', import.meta.url);
function loadComponent(name, hooks) {
  const source = readFileSync(new URL(`${name}.tsx`, base), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name.endsWith('.module.css')) return { default: {} };
    if (name === 'react') return { ...React, ...hooks };
    if (name.startsWith('@/lib/research/')) return require(`../lib/research/${name.slice('@/lib/research/'.length)}.ts`);
    if (name === '../price-targets-panel') return { default: () => null };
    if (name.startsWith('./')) return { default: loadComponent(name.slice(2)) };
    return require(name);
  }, loaded, loaded.exports);
  return loaded.exports.default;
}
const original = {
  id: 'original-preview-' + 'a'.repeat(24), status: 'original-excerpt-unreviewed',
  sourceName: 'Nebius', sourceUrl: 'https://nebius.com/newsroom/original-test', excerptOriginal: 'A short original source excerpt.',
  sourceTimePrecision: 'timestamp', sourcePublishedAt: '2026-10-04T09:00:00Z', sourcePublishedOn: null,
  acquiredAt: '2026-10-04T09:01:00Z', previewPublishedAt: '2026-10-04T09:02:00Z',
};
const official = { id: '77', title: 'Verified company headline', translationJa: '確認済みの企業見出し',
  bodyJa: '確認済みの詳しい本文です。', bodyEn: 'The verified body stays complete.',
  publisher: 'Nebius', tickers: ['NBIS'], url: 'https://nebius.com/newsroom/verified-test',
  publishedAt: '2026-10-04T08:00:00.000Z', observedAt: '2026-10-04T08:01:00Z' };
const wire = (rows = [original], other = {}) => ({ ok: true, enabled: false, items: [], originalPreviewItems: rows, ...other });
function render(feed, lang = 'ja', officialOnly = false, page = 1) {
  let index = 0;
  const Panel = loadComponent('general-news-panel', {
    useState: initial => [index++ === 0 ? feed : index === 5 ? page : typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: () => ({ current: null }), useEffect: () => {},
  });
  return renderToStaticMarkup(React.createElement(Panel, { lang, officialOnly }));
}
const importSource = source => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const routeSource = readFileSync(new URL('../app/api/research/news/route.ts', import.meta.url), 'utf8')
  .replace('"@/lib/research/public-news-response"', JSON.stringify(new URL('../lib/research/public-news-response.ts', import.meta.url).href));
const { GET } = await importSource(routeSource);
let homeSource = readFileSync(new URL('../lib/research/live-result-events.ts', import.meta.url), 'utf8').replace("import 'server-only';", '');
for (const name of ['public-news-response', 'general-news', 'market-results', 'official-result-events']) {
  homeSource = homeSource.replaceAll(`'./${name}'`, JSON.stringify(new URL(`../lib/research/${name}.ts`, import.meta.url).href));
}
const { loadLiveHomeNews } = await importSource(homeSource);

test('original cards are visible inside news with explicit test status, source link and all three clocks', () => {
  const feed = availableNewsPayload(wire());
  for (const lang of ['ja', 'en']) {
    const html = render(feed, lang);
    for (const text of ['ORIGINAL', original.excerptOriginal, original.sourceName,
      lang === 'ja' ? '未翻訳・未確認・テスト掲載' : 'Untranslated · Unreviewed · Test publication',
      lang === 'ja' ? '原文を開く' : 'Read original', lang === 'ja' ? '自動テスト掲載' : 'Automatic test publication',
      '18:00:00 JST', '18:01:00 JST', '18:02:00 JST']) assert.ok(html.includes(text), text);
    assert.ok(html.includes(`href="${original.sourceUrl}"`));
    assert.ok(html.includes('rel="noopener noreferrer"'));
    for (const value of [original.sourcePublishedAt, original.acquiredAt, original.previewPublishedAt]) assert.ok(html.includes(`dateTime="${value}"`));
    assert.doesNotMatch(html, /Business impact|Confidence|確信度|事業への影響/);
    assert.doesNotMatch(render(feed, lang, true), /ORIGINAL|original-test|short original/);
  }
});

test('date-only and unknown original source dates never borrow an acquisition time', () => {
  for (const lang of ['ja', 'en']) {
    const date = render(availableNewsPayload(wire([{ ...original, sourceTimePrecision: 'date', sourcePublishedAt: null, sourcePublishedOn: '2026-10-03' }])), lang);
    assert.ok(date.includes('dateTime="2026-10-03">2026-10-03</time>'));
    assert.ok(date.includes(lang === 'ja' ? '日付のみ・時刻不明' : 'date only; time unknown'));
    assert.doesNotMatch(date, /2026-10-03T|18:00:00/);
    const missing = render(availableNewsPayload(wire([{ ...original, sourceTimePrecision: 'missing', sourcePublishedAt: null }])), lang);
    assert.ok(missing.includes(lang === 'ja' ? '日時不明' : 'Date/time unknown'));
    assert.equal((missing.match(/<time /g) ?? []).length, 2);
  }
});

test('strict original whitelist is bounded and bad adjacent rows cannot erase good or verified cards', () => {
  const poisoned = { ...original, body: 'PRIVATE_FULL_ARTICLE', bodyJa: 'PRIVATE_JAPANESE', modelArguments: { secret: 'PRIVATE_TOKEN' },
    credentials: 'PRIVATE_CREDENTIAL', metadata: { anything: 'PRIVATE_METADATA' }, title: 'UNAPPROVED_TITLE', tickers: ['FAKE'] };
  assert.deepEqual(parseOriginalPreviewItems([poisoned]), [original]);
  const bad = [null, [], { ...original, id: 'raw' }, { ...original, status: 'approved' },
    { ...original, sourceUrl: 'javascript:alert(1)' }, { ...original, sourceUrl: 'https://user:password@nebius.com/news' },
    { ...original, sourceUrl: 'https://nebius.com/news?token=secret' }, { ...original, sourceUrl: 'https://127.0.0.1/news' },
    { ...original, sourceUrl: 'https://localhost.local/news' }, { ...original, sourceName: 'X'.repeat(81) },
    { ...original, excerptOriginal: 'word '.repeat(21) }, { ...original, excerptOriginal: 'See https://source.example/token' }, { ...original, excerptOriginal: 'x'.repeat(101) },
    { ...original, excerptOriginal: '{ \"modelArguments\": \"private\" }' }, { ...original, excerptOriginal: 'Bearer synthetic-long-secret' },
    { ...original, excerptOriginal: 'api_key: synthetic-secret' }, { ...original, excerptOriginal: 'Traceback private arguments' },
    { ...original, excerptOriginal: '原'.repeat(41) }, { ...original, excerptOriginal: 'bad\u202ecopy' },
    { ...original, sourceTimePrecision: 'date' }, { ...original, sourcePublishedAt: '2026-02-30T09:00:00Z' },
    { ...original, acquiredAt: '2026-10-04T09:03:00Z' }, { ...original, sourcePublishedOn: '2026-10-03' }];
  for (const row of bad) {
    assert.throws(() => parseOriginalPreviewItems([row]));
    const feed = availableNewsPayload(wire([row, poisoned], { officialUpdates: [official] }));
    assert.deepEqual(feed.originalPreviewItems, [original]);
    assert.deepEqual(feed.officialUpdates[0], official);
    assert.doesNotMatch(JSON.stringify(feed), /PRIVATE_|UNAPPROVED_TITLE|FAKE/);
  }
  assert.deepEqual(parseOriginalPreviewItems([{ ...original, excerptOriginal: '原'.repeat(40) }])[0].excerptOriginal, '原'.repeat(40));
  assert.throws(() => publicNewsPayload(wire(Array(31).fill(original))));
  assert.deepEqual(availableNewsPayload(wire(Array(31).fill(original))).originalPreviewItems, []);
});

for (const [script, sample] of [['halfwidth Katakana', 'ﾆｭｰｽ'], ['supplementary Han', '𠀀'], ['Hangul Jamo', '가']]) {
  test(`original ${script} excerpt is capped at 40 Unicode code points`, () => {
    const excerptOriginal = Array.from(sample.repeat(40)).slice(0, 40).join('');
    assert.equal(Array.from(excerptOriginal).length, 40);
    assert.equal(parseOriginalPreviewItems([{ ...original, excerptOriginal }])[0].excerptOriginal, excerptOriginal);
    const tooLong = { ...original, excerptOriginal: excerptOriginal + Array.from(sample)[0] };
    assert.throws(() => parseOriginalPreviewItems([tooLong]), /Invalid original excerpt/);
    assert.deepEqual(availableNewsPayload(wire([tooLong, original])).originalPreviewItems, [original]);
  });
}

test('validated canonical URL takes precedence while only the rejected row is omitted', () => {
  const retained = { ...original, id: 'original-preview-' + 'b'.repeat(24), sourceUrl: official.url + '/' };
  const other = { ...original, id: 'original-preview-' + 'c'.repeat(24), sourceUrl: original.sourceUrl + '/' };
  const feed = availableNewsPayload(wire([retained, original, other], { officialUpdates: [official] }));
  assert.deepEqual(feed.originalPreviewItems, [original]);
  const invalidOfficial = { ...official, title: 'x'.repeat(181) };
  assert.equal(availableNewsPayload(wire([retained], { officialUpdates: [invalidOfficial] })).originalPreviewItems.length, 1);
  const xOfficial = { ...official, url: 'https://x.com/NebiusAI/status/77' };
  const xOriginal = { ...original, sourceUrl: 'https://x.com/nebiusai/status/77/' };
  assert.deepEqual(availableNewsPayload(wire([xOriginal], { officialUpdates: [xOfficial] })).originalPreviewItems, []);
});

test('original lane never enters header ticker or changes verified card body and concise headline', () => {
  const legacy = availableNewsPayload({ ok: true, enabled: false, items: [], officialUpdates: [official] });
  const feed = availableNewsPayload(wire([original], { officialUpdates: [official] }));
  for (const lang of ['ja', 'en']) {
    assert.deepEqual(newsPulseItems(feed, lang), newsPulseItems(legacy, lang));
    const before = render(legacy, lang).match(/<article>.*?<\/article>/s)?.[0];
    assert.ok(before);
    assert.ok(render(feed, lang).includes(before));
    assert.deepEqual(newsPulseItems(availableNewsPayload(wire()), lang), []);
  }
});

test('combined news pagination stays at five with 30 bounded original cards and clamped current page', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ ...original, id: 'original-preview-' + i.toString(16).padStart(24, '0'),
    sourceUrl: `https://nebius.com/newsroom/test-${i}`, excerptOriginal: `Original excerpt ${i}.`, previewPublishedAt: `2026-10-04T09:02:${String(i).padStart(2, '0')}Z` }));
  const feed = availableNewsPayload(wire(rows, { officialUpdates: [official] }));
  const first = render(feed, 'en'), sixth = render(feed, 'en', false, 6), final = render(feed, 'en', false, 99);
  assert.equal((first.match(/<article/g) ?? []).length, 5);
  assert.ok(first.indexOf('Original excerpt 29.') < first.indexOf('Original excerpt 25.'));
  assert.doesNotMatch(first, /Original excerpt 24\./);
  assert.equal((sixth.match(/<article/g) ?? []).length, 5);
  assert.ok(sixth.includes('Original excerpt 0.'));
  assert.equal((final.match(/<article/g) ?? []).length, 1);
  assert.ok(final.includes(official.title));
  assert.ok(final.includes('aria-current="page" aria-label="Page 7"'));
});

test('server default drops optional original lane and old protocol remains unchanged', () => {
  assert.equal(buildPublicNews(wire()).originalPreviewItems, undefined);
  const built = buildPublicNews(wire(), { allowOriginalPreview: true });
  assert.deepEqual(built.originalPreviewItems, [original]);
  // An old client recognizes only the existing protocol fields. Additive fields
  // must not be required to read its unchanged verified feed.
  const oldClient = availableNewsPayload({ ok: built.ok, enabled: built.enabled, items: built.items,
    officialUpdates: built.officialUpdates, marketUpdates: built.marketUpdates,
    analystUpdates: built.analystUpdates, resultBriefs: built.resultBriefs, officialHistory: built.officialHistory });
  assert.equal(oldClient.originalPreviewItems, undefined);
  assert.deepEqual(oldClient.officialUpdates, built.officialUpdates);
  assert.deepEqual(availableNewsPayload({ ok: true, enabled: false, items: [] }), { ok: true, enabled: false, items: [] });
});

test('API and streamed HTML fail closed outside preview and opt in only on the existing authenticated monitor read', async () => {
  const saved = { fetch: globalThis.fetch, url: process.env.RESEARCH_MONITOR_URL, token: process.env.RESEARCH_MONITOR_TOKEN, env: process.env.VERCEL_ENV };
  process.env.RESEARCH_MONITOR_URL = 'https://monitor.example.com'; process.env.RESEARCH_MONITOR_TOKEN = 'synthetic-server-token';
  try {
    for (const env of [undefined, 'production', 'development', 'preview']) {
      if (env === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = env;
      const requests = [];
      globalThis.fetch = async (url, init) => { requests.push(String(url)); assert.equal(init.headers.Authorization, 'Bearer synthetic-server-token'); return Response.json(wire()); };
      const response = await GET(new Request('https://frontend.example.com/api/research/news?originalPreview=1'));
      const api = await response.json(), home = await loadLiveHomeNews();
      assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(requests, Array(2).fill(`https://monitor.example.com/news${env === 'preview' ? '?originalPreview=1' : ''}`));
      for (const data of [api, home.news.data]) assert.deepEqual(data.originalPreviewItems, env === 'preview' ? [original] : undefined);
    }
    globalThis.fetch = async () => Response.json({ ...wire(), padding: 'x'.repeat(500_000) });
    assert.equal((await GET()).status, 503);
    assert.equal((await loadLiveHomeNews()).news, null);
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [key, value] of [['RESEARCH_MONITOR_URL', saved.url], ['RESEARCH_MONITOR_TOKEN', saved.token], ['VERCEL_ENV', saved.env]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('optional original bytes give way before unchanged verified history and preserve hard cap', () => {
  const input = { ok: true, enabled: false, items: [], officialUpdates: [{ ...official, bodyJa: 'あ'.repeat(112000), bodyEn: 'x'.repeat(112000) }] };
  const before = boundedOfficialHistory(input), after = boundedOfficialHistory({ ...input,
    originalPreviewItems: Array.from({ length: 30 }, (_, i) => ({ ...original, sourceUrl: original.sourceUrl + '/' + 'x'.repeat(3000) + i })) });
  assert.deepEqual(after.officialUpdates, before.officialUpdates);
  assert.ok(after.originalPreviewItems.length < 30);
  assert.ok(Buffer.byteLength(JSON.stringify(after)) <= 450000);
  assert.equal(input.officialUpdates.length, 1);
  assert.throws(() => boundedOfficialHistory({ ok: true, enabled: false, items: [], fixture: 'x'.repeat(500001), originalPreviewItems: [original] }), /Oversized news core/);
});


test('ordinary default home and dedicated news flow show acquired raw-only cards automatically', () => {
  const feed = availableNewsPayload(wire());
  const NewsFeed = loadComponent('news-feed');
  const html = renderToStaticMarkup(React.createElement(NewsFeed, { lang: 'ja', initialNews: { data: feed, checkedAt: Date.now() } }));
  assert.ok(html.includes(original.excerptOriginal));
  assert.ok(html.includes('ORIGINAL'));
  assert.doesNotMatch(html, /hidden=""/);
  const page = readFileSync(new URL('../app/research/news/page.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes('<NewsFeed lang={lang} />'));
  const home = readFileSync(new URL('../app/research/research-dashboard.tsx', import.meta.url), 'utf8');
  assert.ok(home.includes('<NewsFeed lang={lang} initialNews={initialNews} />'));
});

test('bounded scan metadata is disclosed honestly and stripped from the header snapshot with original cards', () => {
  const window = { recentWindowDays: 7, scanLimitPerLane: 200, displayLimit: 30,
    eligibleInScan: 33, returned: 1, omittedInScan: 32, scanLimited: true };
  const feed = availableNewsPayload(wire([original], { originalPreviewWindow: { ...window, privateArgs: 'PRIVATE_METADATA' }, officialUpdates: [official] }));
  assert.deepEqual(feed.originalPreviewWindow, window);
  for (const lang of ['ja', 'en']) {
    const html = render(feed, lang);
    assert.ok(html.includes(lang === 'ja' ? '直近7日・最大30件' : 'recent 7 days, up to 30 items'));
    assert.ok(html.includes(lang === 'ja' ? 'ほか32件' : '32 more items omitted'));
    assert.ok(html.includes(lang === 'ja' ? '全件表示ではありません' : 'not a complete history'));
  }
  publishNews(feed);
  assert.equal(newsSnapshot().data.originalPreviewItems, undefined);
  assert.equal(newsSnapshot().data.originalPreviewWindow, undefined);
  assert.deepEqual(newsSnapshot().data.officialUpdates, feed.officialUpdates);
  assert.equal(feed.originalPreviewItems.length, 1);
  publishNews(null);
  for (const bad of [{ ...window, eligibleInScan: 601 }, { ...window, returned: 31 }, { ...window, scanLimited: 'yes' }, { ...window, omittedInScan: 0 }]) {
    assert.equal(availableNewsPayload(wire([original], { originalPreviewWindow: bad })).originalPreviewWindow, undefined);
  }
  const invalidRow = { ...original, status: 'approved' };
  const reduced = availableNewsPayload(wire([original, invalidRow], { originalPreviewWindow: { ...window, returned: 2, omittedInScan: 31 } }));
  assert.deepEqual(reduced.originalPreviewWindow, window);
  assert.equal(buildPublicNews(wire([original], { originalPreviewWindow: window })).originalPreviewWindow, undefined);
});
