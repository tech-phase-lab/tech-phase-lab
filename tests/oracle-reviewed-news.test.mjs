import assert from 'node:assert/strict';
import test from 'node:test';
import { availableNewsPayload, publicNewsPayload } from '../lib/research/general-news.ts';

const article = {
  id: '1179', title: 'Oracle Announces Commitment to Absorb $300 Million in Rising Point Beach Energy Costs for Wisconsin Residents',
  url: 'https://www.prnewswire.com/news-releases/oracle-announces-commitment-to-absorb-300-million-in-rising-point-beach-energy-costs-for-wisconsin-residents-302896645.html',
  publisher: 'Oracle / PR Newswire', tickers: ['ORCL'],
  publishedAt: '2026-10-02T13:00:00+00:00', observedAt: '2026-10-02T13:02:02.527+00:00',
  translationJa: 'Oracle、Point Beachの電力費用を負担する計画',
  bodyJa: 'Oracleは費用を負担する計画。委員会の承認が必要。',
  bodyEn: 'Oracle plans to absorb energy costs, subject to commission approval.',
};
const payload = item => ({ ok: true, enabled: false, items: [], officialUpdates: [item] });

test('one reviewed Oracle syndicated source passes without admitting raw evidence', () => {
  const result = publicNewsPayload(payload({ ...article, evidenceQuote: 'PRIVATE QUOTE', bodySha: 'PRIVATE HASH' })).officialUpdates[0];
  assert.equal(result.publisher, 'Oracle / PR Newswire');
  assert.equal(result.bodyJa, article.bodyJa);
  assert.equal(result.bodyEn, article.bodyEn);
  assert.equal(result.publishedAt, '2026-10-02T13:00:00.000Z');
  assert.equal(Date.parse(result.observedAt), Date.parse(article.observedAt));
  assert.equal(result.url, article.url);
  assert.equal(result.evidenceQuote, undefined);
  assert.equal(result.bodySha, undefined);
});

test('Oracle exception does not enable the PR Newswire host or an unrelated event', () => {
  for (const invalid of [
    { ...article, id: '1180' }, { ...article, tickers: ['NVDA'] },
    { ...article, tickers: ['ORCL', 'NVDA'] }, { ...article, publisher: 'Oracle' },
    { ...article, title: 'Another Oracle announcement' },
    { ...article, url: 'https://www.prnewswire.com/news-releases/another-oracle-release-123.html' },
    { ...article, url: article.url + '?tracking=1' },
  ]) {
    assert.throws(() => publicNewsPayload(payload(invalid)), /Invalid official source/);
    assert.deepEqual(availableNewsPayload(payload(invalid)).officialUpdates, []);
  }
});
