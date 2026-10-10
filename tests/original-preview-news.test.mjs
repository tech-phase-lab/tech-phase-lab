import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { availableNewsPayload, publicNewsPayload, boundedOfficialHistory } from '../lib/research/general-news.ts';
import { buildPublicNews } from '../lib/research/public-news-response.ts';
import { parseOriginalPreviewItems, parseOriginalPreviewWindow } from '../lib/research/original-preview-news.ts';
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
const notice = {
  id: 'original-preview-' + 'd'.repeat(24), status: 'sec-filing-notice-unreviewed',
  sourceName: 'SEC EDGAR', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1513845/000110465926112824/tm2626792d1_6k.htm',
  issuerName: 'Nebius', issuerTicker: 'NBIS', form: '6-K', cik: '0001513845', accession: '0001104659-26-112824',
  filingDate: null, acceptedAt: null, bodyAvailability: 'unavailable',
  acquiredAt: '2026-10-01T20:06:08Z', previewPublishedAt: '2026-10-05T01:00:00Z',
};
const official = { id: '77', title: 'Verified company headline', translationJa: '確認済みの企業見出し',
  bodyJa: '確認済みの詳しい本文です。', bodyEn: 'The verified body stays complete.',
  publisher: 'Nebius', tickers: ['NBIS'], url: 'https://nebius.com/newsroom/verified-test',
  publishedAt: '2026-10-04T08:00:00.000Z', observedAt: '2026-10-04T08:01:00Z' };
// The news list shows a test publication only once it has a checked summary.
const summaryFields = { summaryPolicy: 'preview-summary-v1', titleJa: 'ネビウスの原文テスト要約', titleEn: 'Nebius original test summary',
  bodyJa: 'ネビウスは新しいサービスを発表した。発表元は同社。', bodyEn: 'Nebius announced a new service. Source: the company.' };
const summarized = { ...original, ...summaryFields };
function renderCard(item, lang = 'ja') {
  const Card = loadComponent('original-preview-card');
  const [parsed] = parseOriginalPreviewItems([item]);
  return renderToStaticMarkup(React.createElement(Card, { item: parsed, lang }));
}
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

test('a pending original card shows its test status, source link and all three clocks, and is not listed', () => {
  const feed = availableNewsPayload(wire());
  for (const lang of ['ja', 'en']) {
    assert.doesNotMatch(render(feed, lang), /ORIGINAL|short original/);
    const html = renderCard(original, lang);
    for (const text of ['ORIGINAL', original.excerptOriginal, original.sourceName,
      lang === 'ja' ? '翻訳準備中（原文）・未確認・テスト掲載' : 'Summary pending · Unreviewed · Test publication',
      lang === 'ja' ? '原文を開く' : 'Read original', lang === 'ja' ? '自動テスト掲載' : 'Automatic test publication',
      '18:00:00 JST', '18:01:00 JST', '18:02:00 JST']) assert.ok(html.includes(text), text);
    assert.ok(html.includes(`href="${original.sourceUrl}"`));
    assert.ok(html.includes('rel="noopener noreferrer"'));
    for (const value of [original.sourcePublishedAt, original.acquiredAt, original.previewPublishedAt]) assert.ok(html.includes(`dateTime="${value}"`));
    assert.doesNotMatch(html, /Business impact|Confidence|確信度|事業への影響/);
    assert.doesNotMatch(render(availableNewsPayload(wire([summarized])), lang, true), /ORIGINAL|original-test|short original|原文テスト要約|original test summary/);
  }
});

test('date-only and unknown original source dates never borrow an acquisition time', () => {
  for (const lang of ['ja', 'en']) {
    const date = renderCard({ ...original, sourceTimePrecision: 'date', sourcePublishedAt: null, sourcePublishedOn: '2026-10-03' }, lang);
    assert.ok(date.includes('dateTime="2026-10-03">2026-10-03</time>'));
    assert.ok(date.includes(lang === 'ja' ? '日付のみ・時刻不明' : 'date only; time unknown'));
    assert.doesNotMatch(date, /2026-10-03T|18:00:00/);
    const missing = renderCard({ ...original, sourceTimePrecision: 'missing', sourcePublishedAt: null }, lang);
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
  const rows = Array.from({ length: 30 }, (_, i) => ({ ...summarized, id: 'original-preview-' + i.toString(16).padStart(24, '0'),
    sourceUrl: `https://nebius.com/newsroom/test-${i}`, excerptOriginal: `Excerpt ${i}.`, titleEn: `Original excerpt ${i}.`,
    previewPublishedAt: `2026-10-04T09:02:${String(i).padStart(2, '0')}Z` }));
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
      globalThis.fetch = async (url, init) => { requests.push(String(url)); assert.equal(init.headers.Authorization, 'Bearer synthetic-server-token'); return Response.json(wire([original, notice])); };
      const response = await GET(new Request('https://frontend.example.com/api/research/news?originalPreview=1'));
      const api = await response.json(), home = await loadLiveHomeNews();
      assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(requests, Array(2).fill(`https://monitor.example.com/news${env === 'preview' ? '?originalPreview=1' : ''}`));
      for (const data of [api, home.news.data]) assert.deepEqual(data.originalPreviewItems, env === 'preview' ? [original, notice] : undefined);
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


test('ordinary default home and dedicated news flow show summarized test cards and hide untranslated ones', () => {
  const pending = { ...original, id: 'original-preview-' + 'b'.repeat(24), sourceUrl: 'https://nebius.com/newsroom/pending-test',
    excerptOriginal: 'An untranslated pending excerpt.' };
  const feed = availableNewsPayload(wire([summarized, pending]));
  const NewsFeed = loadComponent('news-feed');
  const html = renderToStaticMarkup(React.createElement(NewsFeed, { lang: 'ja', initialNews: { data: feed, checkedAt: Date.now() } }));
  assert.ok(html.includes(summaryFields.titleJa));
  assert.ok(!html.includes(pending.excerptOriginal));
  assert.doesNotMatch(html, /hidden=""/);
  const page = readFileSync(new URL('../app/research/news/page.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes('<NewsFeed lang={lang} />'));
  const home = readFileSync(new URL('../app/research/research-dashboard.tsx', import.meta.url), 'utf8');
  assert.ok(home.includes('<NewsFeed lang={lang} initialNews={initialNews} />'));
});

test('bounded scan metadata is disclosed honestly; only summarized cards reach the header snapshot', () => {
  const window = { recentWindowDays: 7, scanLimitPerLane: 200, displayLimit: 30,
    eligibleInScan: 33, returned: 1, omittedInScan: 32, scanLimited: true };
  const feed = availableNewsPayload(wire([summarized], { originalPreviewWindow: { ...window, privateArgs: 'PRIVATE_METADATA' }, officialUpdates: [official] }));
  assert.deepEqual(feed.originalPreviewWindow, window);
  for (const lang of ['ja', 'en']) {
    const html = render(feed, lang);
    assert.ok(html.includes(lang === 'ja' ? '直近7日・最大30件' : 'recent 7 days, up to 30 items'));
    assert.ok(html.includes(lang === 'ja' ? 'ほか32件' : '32 more items omitted'));
    assert.ok(html.includes(lang === 'ja' ? '全件表示ではありません' : 'not a complete history'));
  }
  publishNews(feed);
  // Only summarized test cards reach the header; the scan window never does.
  assert.deepEqual(newsSnapshot().data.originalPreviewItems.map(item => item.id), [summarized.id]);
  assert.equal(newsSnapshot().data.originalPreviewWindow, undefined);
  publishNews(availableNewsPayload(wire([original], { officialUpdates: [official] })));
  assert.equal(newsSnapshot().data.originalPreviewItems, undefined);
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


test('SEC metadata notices disclose unavailable body and unknown filing clocks without inventing excerpts', () => {
  assert.deepEqual(parseOriginalPreviewItems([notice]), [notice]);
  const feed = availableNewsPayload(wire([notice], { officialUpdates: [official] }));
  for (const lang of ['ja', 'en']) {
    // Metadata-only notices are not listed in the news; the card itself stays correct.
    assert.doesNotMatch(render(feed, lang), /Filing notice|提出情報|Form 6-K/);
    const html = renderCard(notice, lang);
    for (const text of ['SEC EDGAR', 'Nebius (NBIS) · Form 6-K', notice.sourceUrl,
      lang === 'ja' ? '提出情報・未確認・テスト掲載' : 'Filing notice · Unreviewed · Test publication',
      lang === 'ja' ? '本文未取得' : 'Body unavailable', lang === 'ja' ? '日時不明' : 'Date/time unknown',
      lang === 'ja' ? '提出情報取得' : 'Metadata acquired']) assert.ok(html.includes(text), text);
    assert.ok(html.includes(`dateTime="${notice.acquiredAt}"`));
    assert.ok(html.includes(`dateTime="${notice.previewPublishedAt}"`));
    assert.doesNotMatch(html, /PRIVATE|Source published|原文発表|excerptOriginal/);
    assert.doesNotMatch(render(feed, lang, true), /Filing notice|提出情報|Form 6-K/);
    assert.deepEqual(newsPulseItems(feed, lang), newsPulseItems(availableNewsPayload(wire([], { officialUpdates: [official] })), lang));
  }
  const enriched = { ...notice, filingDate: '2026-10-01', acceptedAt: '2026-10-01T16:01:00-04:00', bodyAvailability: 'retained-unreviewed' };
  const html = renderCard(enriched, 'en');
  assert.ok(html.includes('Body retained; unreviewed and not shown'));
  assert.ok(html.includes('dateTime="2026-10-01">2026-10-01</time>'));
  assert.ok(html.includes('SEC accepted'));
  assert.ok(html.includes('dateTime="2026-10-01T16:01:00-04:00"'));
});

test('SEC notice whitelist rejects identity or clock corruption and isolates bad adjacent rows', () => {
  const poisoned = { ...notice, excerptOriginal: 'PRIVATE EXCERPT', title: 'PRIVATE TITLE', body: 'PRIVATE BODY', error: 'PRIVATE ERROR', credentials: 'PRIVATE TOKEN' };
  assert.deepEqual(parseOriginalPreviewItems([poisoned]), [notice]);
  const bad = [
    { ...notice, sourceName: 'SEC News' }, { ...notice, issuerTicker: 'AAPL' }, { ...notice, issuerName: 'Fabricated issuer' },
    { ...notice, form: '10-K' }, { ...notice, form: '8-K' }, { ...notice, cik: '1513845' },
    { ...notice, accession: '0001104659-26-112825' }, { ...notice, sourceUrl: notice.sourceUrl.replace('/1513845/', '/320193/') },
    { ...notice, sourceUrl: notice.sourceUrl + '?token=private' },
    { ...notice, sourceUrl: notice.sourceUrl.replace('www.sec.gov', 'www.sec.gov:443') },
    { ...notice, sourceUrl: notice.sourceUrl.replace('tm2626792d1_6k.htm', '../000110465926112824/tm2626792d1_6k.htm') },
    { ...notice, acceptedAt: '2026-10-01T20:00:00-00:00' }, { ...notice, bodyAvailability: 'reviewed' },
    { ...notice, filingDate: '2026-02-30' }, { ...notice, filingDate: '2026-10-06' }, { ...notice, filingDate: undefined },
    { ...notice, acceptedAt: '2026-10-01T20:07:00Z' }, { ...notice, acceptedAt: '2026-10-01T20:00:00' },
    { ...original, sourceUrl: notice.sourceUrl },
  ];
  for (const row of bad) {
    assert.throws(() => parseOriginalPreviewItems([row]));
    const feed = availableNewsPayload(wire([row, poisoned, original], { officialUpdates: [official] }));
    assert.deepEqual(feed.originalPreviewItems, [notice, original]);
    assert.deepEqual(feed.officialUpdates, [official]);
    assert.doesNotMatch(JSON.stringify(feed), /PRIVATE/);
  }
});

test('SEC document aliases deduplicate by accession and only a visible reviewed accession wins', () => {
  const alias = { ...notice, id: 'original-preview-' + 'e'.repeat(24), sourceUrl: notice.sourceUrl.replace('tm2626792d1_6k.htm', 'exhibit991.htm') };
  assert.deepEqual(availableNewsPayload(wire([notice, alias])).originalPreviewItems, [notice]);
  const mu = { ...notice, issuerName: 'Micron', issuerTicker: 'MU', form: '8-K', cik: '0000723125',
    accession: '0000723125-26-000018', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/723125/000072312526000018/form8k.htm' };
  const reviewed = { ...official, id: '19', publisher: 'Micron', tickers: ['MU'],
    url: 'https://www.sec.gov/Archives/edgar/data/723125/000072312526000018/a2026q4ex991-pressrelease.htm' };
  assert.deepEqual(availableNewsPayload(wire([mu], { officialUpdates: [reviewed] })).originalPreviewItems, []);
  assert.deepEqual(availableNewsPayload(wire([mu], { officialUpdates: [{ ...reviewed, title: 'x'.repeat(181) }] })).originalPreviewItems, [mu]);
  const otherAccession = { ...mu, id: alias.id, accession: '0000723125-26-000019', sourceUrl: mu.sourceUrl.replace('000018/', '000019/') };
  assert.deepEqual(availableNewsPayload(wire([otherAccession], { officialUpdates: [reviewed] })).originalPreviewItems, [otherAccession]);
});

test('SEC notices use the same overall caps, production strip, and header isolation', () => {
  assert.equal(buildPublicNews(wire([notice])).originalPreviewItems, undefined);
  assert.deepEqual(buildPublicNews(wire([notice]), { allowOriginalPreview: true }).originalPreviewItems, [notice]);
  assert.throws(() => parseOriginalPreviewItems(Array(31).fill(notice)));
  const window = { recentWindowDays: 7, scanLimitPerLane: 200, displayLimit: 30, eligibleInScan: 1200, returned: 1, omittedInScan: 1199, scanLimited: true };
  assert.deepEqual(parseOriginalPreviewWindow(window, 1), window);
  assert.equal(parseOriginalPreviewWindow({ ...window, eligibleInScan: 1201, omittedInScan: 1200 }, 1), undefined);
  publishNews(availableNewsPayload(wire([notice])));
  assert.equal(newsSnapshot().originalPreviewItems, undefined);
});

const metadataNotice = {
  id: 'original-preview-' + 'f'.repeat(24), status: 'source-metadata-notice-unreviewed',
  sourceName: 'Nebius', sourceUrl: 'https://nebius.com/newsroom/retained-metadata',
  sourceClass: 'issuer-metadata', titleOriginal: 'Nebius announces a retained source update',
  sourcePublishedOn: null, bodyAvailability: 'unavailable',
  acquiredAt: '2026-10-04T20:00:00Z', previewPublishedAt: '2026-10-05T01:00:00Z',
};
const twseNotice = { ...metadataNotice, id: 'original-preview-' + '1'.repeat(24),
  sourceName: 'TWSE · TSMC', sourceClass: 'exchange-disclosure', titleOriginal: '本公司重要訊息測試',
  sourceUrl: 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L?company=2330&date=1151004&time=180000&id=0123456789abcdef',
  sourcePublishedOn: '2026-10-04', bodyAvailability: 'retained-unreviewed' };
const docNotice = { ...metadataNotice, sourceName: 'Nebius · Preemptible VMs', sourceClass: 'official-document',
  sourceUrl: 'https://docs.nebius.com/compute/virtual-machines/preemptible', titleOriginal: null, bodyAvailability: 'retained-unreviewed' };
const seedRows = JSON.parse(readFileSync(new URL('../scripts/research/sources.json', import.meta.url), 'utf8'));
const pdfNotices = seedRows.filter(row => row.url.startsWith('https://assets.nebius.com/')).map((row, index) => ({ ...metadataNotice,
  id: 'original-preview-' + String(index + 2).repeat(24), sourceName: 'Nebius · PDF', sourceClass: 'seeded-document',
  sourceUrl: row.url, titleOriginal: null, sourcePublishedOn: row.publishedOn }));

test('configured metadata notices show correct source class, unknown dates and no copied body', () => {
  for (const item of [metadataNotice, twseNotice, docNotice, ...pdfNotices]) {
    const injected = { ...item, text: 'PRIVATE_BODY', bodyJa: 'PRIVATE_TRANSLATION', error: 'PRIVATE_ERROR', extra: 'PRIVATE_METADATA' };
    assert.deepEqual(parseOriginalPreviewItems([injected]), [item]);
    for (const lang of ['ja', 'en']) {
      assert.doesNotMatch(render(availableNewsPayload(wire([injected])), lang), /SOURCE|出典情報のみ|Source metadata only/);
      const html = renderCard(injected, lang);
      assert.ok(html.includes(lang === 'ja' ? '出典情報のみ。本文の内容は未確認・非表示です。' : 'Source metadata only. Contents are unreviewed and not shown.'));
      assert.ok(html.includes(item.sourceName));
      assert.ok(html.includes(lang === 'ja' ? '出典情報取得' : 'Source metadata acquired'));
      assert.doesNotMatch(html, /PRIVATE_BODY|PRIVATE_TRANSLATION|PRIVATE_ERROR|PRIVATE_METADATA/);
      assert.equal((html.match(/<time /g) ?? []).length, item.sourcePublishedOn ? 3 : 2);
      assert.doesNotMatch(render(availableNewsPayload(wire([injected])), lang, true), /SOURCE|出典情報のみ|Source metadata only/);
    }
  }
});

test('query and document exceptions remain exact, source-specific, and metadata-only', () => {
  const bad = [
    { ...metadataNotice, sourceUrl: metadataNotice.sourceUrl + '?token=private' },
    { ...metadataNotice, sourceName: 'Different publisher' },
    { ...metadataNotice, titleOriginal: null },
    { ...metadataNotice, titleOriginal: 'Bearer PRIVATE_SYNTHETIC_TOKEN' },
    { ...metadataNotice, sourcePublishedOn: '2026-10-05' },
    { ...twseNotice, sourceUrl: twseNotice.sourceUrl + '&secret=1' },
    { ...twseNotice, sourceUrl: twseNotice.sourceUrl.replace('2330', '2317') },
    { ...twseNotice, sourceUrl: twseNotice.sourceUrl.replace('180000', '250000') },
    { ...twseNotice, sourceUrl: twseNotice.sourceUrl.replace('1151004', '1150230') },
    { ...twseNotice, sourcePublishedOn: null },
    { ...twseNotice, bodyAvailability: 'unavailable' },
    { ...twseNotice, sourceClass: 'issuer-metadata' },
    { ...docNotice, titleOriginal: 'Invented document headline' },
    { ...docNotice, sourceUrl: docNotice.sourceUrl + '/new-provider' },
    { ...docNotice, bodyAvailability: 'unavailable' },
    { ...docNotice, sourcePublishedOn: '2026-10-04' },
    { ...pdfNotices[0], sourceUrl: pdfNotices[0].sourceUrl + '&extra=1' },
    { ...pdfNotices[0], sourcePublishedOn: '2026-10-04' },
    { ...metadataNotice, sourceUrl: 'https://newsletter.semianalysis.com/p/retained-article' },
    { ...original, sourceUrl: twseNotice.sourceUrl },
    { ...original, sourceUrl: pdfNotices[0].sourceUrl },
  ];
  for (const row of bad) assert.throws(() => parseOriginalPreviewItems([row]), row.sourceUrl);
});

test('different TWSE disclosures remain distinct and verified cards keep precedence', () => {
  const second = { ...twseNotice, id: 'original-preview-' + '9'.repeat(24), sourceUrl: twseNotice.sourceUrl.replace('0123456789abcdef', '1123456789abcdef') };
  assert.deepEqual(availableNewsPayload(wire([twseNotice, second])).originalPreviewItems, [twseNotice, second]);
  const reviewed = { ...official, url: metadataNotice.sourceUrl };
  assert.deepEqual(availableNewsPayload(wire([metadataNotice], { officialUpdates: [reviewed] })).originalPreviewItems, []);
  assert.deepEqual(availableNewsPayload(wire([metadataNotice], { officialUpdates: [{ ...reviewed, title: 'x'.repeat(181) }] })).originalPreviewItems, [metadataNotice]);
});

test('metadata notices preserve production and header isolation and the unchanged card bound', () => {
  assert.equal(buildPublicNews(wire([metadataNotice])).originalPreviewItems, undefined);
  assert.deepEqual(buildPublicNews(wire([metadataNotice]), { allowOriginalPreview: true }).originalPreviewItems, [metadataNotice]);
  assert.throws(() => parseOriginalPreviewItems(Array(31).fill(metadataNotice)));
  publishNews(availableNewsPayload(wire([metadataNotice])));
  assert.equal(newsSnapshot().originalPreviewItems, undefined);
});

test('a checked bilingual summary shows one line with the detail behind ＋ and keeps the source link', () => {
  const summary = { summaryPolicy: 'preview-summary-v1', titleJa: 'Bluevine、Coverdashと中小企業向け保険で提携',
    titleEn: 'Bluevine partners with Coverdash on small business insurance',
    bodyJa: 'BluevineはCoverdashと提携し、中小企業向けに組み込み型の事業保険を提供すると発表した。発表元はPR Newswire。',
    bodyEn: 'Bluevine announced a partnership with Coverdash to offer embedded business insurance to small businesses. Source: PR Newswire.' };
  const payload = wire();
  payload.originalPreviewItems = payload.originalPreviewItems.map(item => item.status === 'original-excerpt-unreviewed' ? { ...item, ...summary } : item);
  const feed = availableNewsPayload(payload);
  const ja = render(feed, 'ja'), en = render(feed, 'en');
  assert.ok(ja.includes(summary.titleJa) && ja.includes(summary.bodyJa) && ja.includes('＋') && ja.includes('AI要約'));
  assert.ok(en.includes(summary.titleEn) && en.includes(summary.bodyEn));
  assert.ok(ja.includes('rel="noopener noreferrer"'));
  const [unsafe] = parseOriginalPreviewItems([{ ...payload.originalPreviewItems.find(i => i.status === 'original-excerpt-unreviewed'), ...summary, bodyEn: 'see https://evil.example now' }]);
  assert.equal(unsafe.summary, undefined);
});

test('a summarized test publication appears in the top strip with its one-line title', () => {
  const feed = availableNewsPayload(wire([{ ...summarized, pulseTitleJa: 'ネビウス新サービス発表', pulseTitleEn: 'Nebius launches a new service' }]));
  const ja = newsPulseItems(feed, 'ja'), en = newsPulseItems(feed, 'en');
  assert.equal(ja[0].headlines[0], 'ネビウス新サービス発表');
  assert.equal(en[0].headlines[0], 'Nebius launches a new service');
  assert.equal(newsPulseItems(availableNewsPayload(wire([original])), 'ja').length, 0);
});
