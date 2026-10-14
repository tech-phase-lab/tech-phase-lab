import test from 'node:test';
import assert from 'node:assert/strict';
import { earningsResults } from '../lib/research/earnings-results.ts';

const brief = { id: '5', researchId: 'x-result-5', kind: 'earnings', ticker: 'TSM', period: 'Q3 2026',
  titleJa: 'TSM Q3 2026決算：売上高NT$989.9B', titleEn: 'TSM Q3 2026 earnings: Revenue NT$989.9B',
  facts: [{ key: 'revenue', ja: '売上高', en: 'Revenue', value: 'NT$989.9B' }], url: 'https://x.com/wallstengine/status/5',
  publisher: 'Wall St Engine', publishedAt: '2026-10-16T05:31:00Z', observedAt: '2026-10-16T05:31:20Z', publicAt: '2026-10-16T05:31:21Z' };
const update = (title, extra = {}) => ({ id: '9', title, url: 'https://www.apple.com/newsroom/2026/10/x/', publisher: 'Apple',
  tickers: ['AAPL'], observedAt: '2026-10-30T20:31:00Z', publishedAt: '2026-10-30T20:30:00Z', ...extra });

test('released earnings combine flashes and the companies own results releases, newest first', () => {
  const rows = earningsResults([update('Apple reports fourth quarter results', { translationJa: 'Apple、第4四半期決算を発表' })], [brief]);
  assert.deepEqual(rows.map(row => [row.ticker, row.kind]), [['AAPL', 'release'], ['TSM', 'flash']]);
  assert.equal(rows[1].result.ja, brief.titleJa);
  assert.equal(rows[0].result.ja, 'Apple、第4四半期決算を発表');
});

test('date notices, call invitations, other news and economic flashes are not earnings results', () => {
  for (const title of ['Apple to report fourth quarter results on Oct 30', 'Apple announces date for Q4 earnings conference call', 'Apple unveils new iPad'])
    assert.deepEqual(earningsResults([update(title)], []), []);
  assert.deepEqual(earningsResults([], [{ ...brief, kind: 'economic', ticker: 'ECON' }]), []);
  assert.equal(earningsResults([update('Apple reports fourth quarter results')], [])[0].result.ja, null);
});

test('a release and its flash, or two copies of one release, are one earnings row', () => {
  const flash = { ...brief, ticker: 'AAPL', publishedAt: '2026-10-30T20:40:00Z' };
  const rows = earningsResults([update('Apple reports fourth quarter results', { translationJa: 'Apple、第4四半期決算を発表' }),
    update('Apple Q4 2026 earnings release', { id: '10', url: 'https://mfn.se/a/1', publisher: 'Apple / MFN', publishedAt: '2026-10-30T20:31:00Z' })], [flash]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'release');
  assert.equal(rows[0].result.ja, flash.titleJa);
  assert.deepEqual(rows[0].facts.map(fact => fact.ja), ['売上高 NT$989.9B']);
  assert.equal(rows[0].sources.length, 3);
});

test('another quarter days later stays a separate row, and bodies come only from the release', () => {
  const rows = earningsResults([update('Apple reports fourth quarter results', { bodyJa: '売上高は増加しました。', bodyEn: 'Revenue rose.' }),
    update('Apple reports first quarter results', { id: '11', publishedAt: '2026-12-05T20:30:00Z', observedAt: '2026-12-05T20:31:00Z' })], []);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].body.ja, '売上高は増加しました。');
  assert.equal(rows[0].body.ja, null);
});
