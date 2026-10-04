import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { parseAnalystUpdates, analystNewsDisplay } from '../lib/research/analyst-news.ts';
import { availableNewsPayload, publicNewsPayload } from '../lib/research/general-news.ts';
import { newsPulseItems } from '../lib/research/news-pulse-items.ts';

// Synthetic, explicitly attributed reporting; no investment assessment is inferred.
const item = { id: '12345', ticker: 'NVDA', firm: 'Example Research', action: 'top-pick',
  titleJa: '報道によると、Example ResearchがNVDAをトップピックに選定',
  titleEn: 'Reportedly, Example Research names NVDA a top pick',
  bodyJa: '報道によると、Example Researchの評価は据え置き。',
  bodyEn: 'Reportedly, Example Research keeps its rating unchanged.',
  publishedAt: '2026-10-02T08:09:10+09:00', observedAt: '2026-10-03T00:00:00.000Z' };
const payload = rows => ({ ok: true, enabled: false, items: [], analystUpdates: rows });

test('analyst feed accepts all six actions, bilingual copy and original clocks with general news disabled', () => {
  const actions = ['initiation', 'upgrade', 'downgrade', 'top-pick', 'conviction-list', 'tactical-list'];
  for (const action of actions) {
    const row = { ...item, action };
    assert.deepEqual(parseAnalystUpdates([row]), [row]);
    const feed = publicNewsPayload(payload([row]));
    assert.deepEqual(feed.analystUpdates, [row]);
    assert.equal(feed.enabled, false);
    assert.deepEqual(feed.items, []);
    assert.equal(feed.officialUpdates, undefined);
  }
  for (const ticker of ['NVDA', 'BRK.B', 'BRK-B', 'A']) assert.equal(parseAnalystUpdates([{ ...item, ticker }])[0].ticker, ticker);
});

test('analyst validation reconstructs only public fields and never copies provenance or assessments', () => {
  const row = { ...item, url: 'https://x.com/WallStEngine/status/12345', account: 'WallStEngine',
    text: 'PRIVATE SOURCE TEXT', sourceText: 'PRIVATE SOURCE TEXT', sourceId: 'PRIVATE-SOURCE-ID',
    sources: [{ url: 'https://x.com/WallStEngine/status/12345' }], confidence: 'high', impact: 'positive', oldPrice: 90 };
  const feed = publicNewsPayload(payload([row]));
  assert.deepEqual(feed.analystUpdates, [item]);
  assert.doesNotMatch(JSON.stringify(feed), /PRIVATE|WallStEngine|x\.com|confidence|impact|oldPrice/);
});

test('analyst rows require strict bounded strings, action enums, ticker and paired optional bodies', () => {
  const invalid = [null, [], { id: '12a' }, { id: '1'.repeat(25) }, { ticker: 'NVDA1' }, { ticker: 'NASDAQ:NVDA' },
    { ticker: 'nvda' }, { ticker: 'BRK.BB' }, { action: 'buy' }, { action: 'official' }, { firm: '' },
    { firm: 'a'.repeat(81) }, { titleJa: 'あ'.repeat(181) }, { titleEn: '' }, { titleEn: 7 }, { titleEn: 'headline\nextra' },
    { bodyJa: 'あ'.repeat(1201) }, { bodyEn: '' }, { bodyJa: undefined }, { bodyEn: null }, { titleEn: 'unsafe\0copy' },
    { bodyEn: 'https://x.com/source/status/123' }, { titleEn: 'Reported by @Source' }, { firm: 'TipRanks' },
    { titleJa: 'Wall St Engineによると' }];
  for (const change of invalid) {
    const row = change && !Array.isArray(change) ? { ...item, ...change } : change;
    assert.throws(() => parseAnalystUpdates([row]), JSON.stringify(change));
  }
  const headlineOnly = { ...item };
  delete headlineOnly.bodyJa; delete headlineOnly.bodyEn;
  assert.deepEqual(parseAnalystUpdates([headlineOnly]), [headlineOnly]);
  assert.equal(parseAnalystUpdates([{ ...item, titleJa: '🤖'.repeat(180) }])[0].titleJa, '🤖'.repeat(180));
  assert.throws(() => parseAnalystUpdates([{ ...item, titleJa: '🤖'.repeat(181) }]));
});

test('analyst clocks reject missing timezone, impossible calendar days, clock overflow and reversed chronology', () => {
  for (const publishedAt of ['2026-10-02', '2026-10-02T00:00:00', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z',
    '2026-10-02T24:00:00Z', '2026-10-02T12:60:00Z', '2026-10-02T12:00:60Z', '2026-10-04T00:00:00Z']) {
    assert.throws(() => parseAnalystUpdates([{ ...item, publishedAt }]), publishedAt);
  }
  assert.throws(() => parseAnalystUpdates([{ ...item, observedAt: '2026-10-03T00:00:00' }]));
  const sameInstant = { ...item, observedAt: '2026-10-01T23:09:10Z' };
  assert.deepEqual(parseAnalystUpdates([sameInstant]), [sameInstant]);
});

test('malformed analyst article is isolated from valid analyst and other feed sections', () => {
  const official = { id: '42', title: 'Official update', url: 'https://nebius.com/blog/update', publisher: 'Nebius',
    tickers: ['NBIS'], observedAt: '2026-10-02T00:00:00Z' };
  const feed = availableNewsPayload({ ...payload([{ ...item, action: 'official' }, item, { ...item, titleEn: null }]),
    officialUpdates: [{ ...official, url: 'https://evil.example/' }, official] });
  assert.deepEqual(feed.analystUpdates, [item]);
  assert.deepEqual(feed.officialUpdates, [official]);
  assert.deepEqual(availableNewsPayload(payload({ invalid: true })).analystUpdates, []);
  assert.deepEqual(availableNewsPayload(payload(Array.from({ length: 31 }, () => item))).analystUpdates, []);
  assert.equal(publicNewsPayload(payload(Array.from({ length: 30 }, () => item))).analystUpdates.length, 30);
  assert.throws(() => publicNewsPayload(payload(Array.from({ length: 31 }, () => item))));
});

test('JA and EN pulse use analyst labels and unchanged source publication time even after late acquisition', () => {
  const feed = publicNewsPayload(payload([item]));
  for (const lang of ['ja', 'en']) {
    const ja = lang === 'ja', display = analystNewsDisplay(item, lang), [pulse] = newsPulseItems(feed, lang);
    assert.equal(display.label, ja ? 'アナリスト動向 · NVDA' : 'Analyst news · NVDA');
    assert.equal(pulse.id, `analyst-${item.id}`);
    assert.equal(pulse.ticker, display.label);
    assert.equal(pulse.title, ja ? item.titleJa : item.titleEn);
    assert.equal(pulse.shortTitle, pulse.title);
    assert.equal(pulse.body, `${pulse.title}\n\n${ja ? item.bodyJa : item.bodyEn}`);
    assert.equal(pulse.at, item.publishedAt);
    assert.equal(pulse.kind, 'published');
    assert.equal(pulse.url, undefined);
    assert.doesNotMatch(JSON.stringify(pulse), /official|confidence|impact|x\.com/);
  }
});

test('analyst pulse is merged into latest-five ordering by publication, never observation', () => {
  const market = { id: '99', topic: 'crude-oil', titleJa: '原油', titleEn: 'Crude oil',
    url: 'https://x.com/Barchart/status/99', publishedAt: '2026-10-02T12:00:00Z', observedAt: '2026-10-02T12:01:00Z' };
  const feed = publicNewsPayload({ ...payload(Array.from({ length: 6 }, (_, i) => ({ ...item,
    id: String(i), publishedAt: `2026-10-01T0${i}:00:00Z` }))), marketUpdates: [market] });
  for (const lang of ['ja', 'en']) {
    assert.deepEqual(newsPulseItems(feed, lang).map(row => row.id), ['market-99', 'analyst-5', 'analyst-4', 'analyst-3', 'analyst-2']);
  }
});

test('public news API carries accepted analyst reporting without reclassifying it as official', async () => {
  let source = await readFile(new URL('../app/api/research/news/route.ts', import.meta.url), 'utf8');
  for (const name of ['public-news-response', 'general-news', 'official-result-events', 'result-news', 'mu-latest']) {
    source = source.replace(new RegExp(`["']@/lib/research/${name}["']`, 'g'),
      JSON.stringify(new URL(`../lib/research/${name}.ts`, import.meta.url).href));
  }
  const { GET } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
  const previous = { fetch: globalThis.fetch, url: process.env.RESEARCH_MONITOR_URL, token: process.env.RESEARCH_MONITOR_TOKEN };
  process.env.RESEARCH_MONITOR_URL = 'https://monitor.example.com';
  process.env.RESEARCH_MONITOR_TOKEN = 'synthetic-test-token';
  try {
    globalThis.fetch = async () => Response.json(payload([{ ...item, action: 'not-an-action' }, item]));
    const response = await GET(), data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.enabled, false);
    assert.deepEqual(data.analystUpdates, [item]);
    assert.ok(!data.officialUpdates.some(row => row.id === item.id));
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [['RESEARCH_MONITOR_URL', previous.url], ['RESEARCH_MONITOR_TOKEN', previous.token]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('intake analyst counts expose only fixed rejection labels and valid numeric counts', async () => {
  const source = await readFile(new URL('../app/research/intake/intake-dashboard.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('export function analystNewsStatus('), end = source.indexOf('\nfunction webPushStatus(', start);
  assert.ok(start >= 0 && end > start);
  const { analystNewsStatus } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source.slice(start, end))).toString('base64'));
  const state = { eligible: 6, published: 2, pending: 1, excluded: 3,
    rejectionReasons: { 'ambiguous-target': 2, 'PRIVATE SOURCE TEXT': 1, 'ambiguous-firms': 'PRIVATE TEXT' } };
  const status = analystNewsStatus(state);
  assert.match(status, /対象 6・公開 2・保留 1・除外 3/);
  assert.match(status, /目標株価が曖昧 2件・未対応 1件/);
  assert.doesNotMatch(status, /PRIVATE|ambiguous-target|ambiguous-firms/);
  assert.equal(analystNewsStatus(undefined), '');
  assert.match(analystNewsStatus({ ...state, pending: -1 }), /状態取得待ち/);
  assert.match(analystNewsStatus({ ...state, published: 'PRIVATE TEXT' }), /状態取得待ち/);
});
