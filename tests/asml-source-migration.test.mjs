import test from 'node:test';
import assert from 'node:assert/strict';
import { publicNewsPayload, availableNewsPayload } from '../lib/research/general-news.ts';
import { officialResultEvents } from '../lib/research/official-result-events.ts';
import { snapshotIssues } from '../lib/research/intake.ts';

const url = 'https://investor.asml.com/news-releases/news-release-details/asml-begins-construction-new-eindhoven-campus-strengthening-its-presence-brainport-region';
const observed = '2026-10-02T18:00:00Z';
const update = {
  id: '123', title: 'ASML campus release', publisher: 'ASML', url,
  tickers: ['ASML'], observedAt: observed, publishedOn: '2026-09-08', researchId: 'ir-result-123',
};
const invalidUrls = [
  'https://investor.asml.com/news/press-releases-and-announcements',
  'https://investor.asml.com/quarterly-results',
  'https://investor.asml.com/news-releases/news-release-details/',
  url + '/attachment', url + '.pdf', url + '?tracking=1', url + '#section',
  url.replace('investor.asml.com', 'unknown.asml.com'),
  url.replace('investor.asml.com', 'investor.asml.com.evil.example'),
];

test('ASML migrated releases reach public news with separate publication and observation dates', () => {
  const payload = { ok: true, enabled: false, items: [], officialUpdates: [update] };
  for (const parse of [publicNewsPayload, availableNewsPayload]) {
    const [article] = parse(payload).officialUpdates;
    assert.equal(article.url, url);
    assert.equal(article.publishedOn, '2026-09-08');
    assert.equal(article.observedAt, observed);
    assert.equal(article.publishedAt, undefined);
  }
  for (const changes of [...invalidUrls.map(url => ({ url })), { tickers: ['TSM'] }]) {
    const invalid = { ...payload, officialUpdates: [{ ...update, ...changes }] };
    assert.throws(() => publicNewsPayload(invalid), /Invalid official source/);
    assert.deepEqual(availableNewsPayload(invalid).officialUpdates, []);
  }
});

test('ASML issuer result validation uses the same exact migrated article rule', () => {
  const copy = { ja: 'ASMLの公式発表', en: 'ASML official announcement' };
  const note = {
    id: 'ir-result-123', ticker: 'ASML', kind: 'product', title: copy, summary: copy,
    facts: [copy, copy, copy], purpose: copy, url, sourceTitle: copy.en,
    publishedOn: '2026-09-08', dateBasis: 'publication', publicAt: observed,
  };
  const [event] = officialResultEvents([note]);
  assert.equal(event.sources[0].url, url);
  assert.equal(event.publishedOn, '2026-09-08');
  for (const changes of [...invalidUrls.map(url => ({ url })), { ticker: 'TSM' }]) {
    assert.throws(() => officialResultEvents([{ ...note, ...changes }]), /Invalid issuer source/);
  }
});

test('ASML source evidence validation accepts the migrated release but rejects unrelated pages', () => {
  const source = {
    url, ticker: 'ASML', title: 'ASML campus release', published_on: '2026-09-08',
    discovered_at: observed, checked_at: observed, sha256: 'a'.repeat(64),
    status: 'pending', error: null, evidence_url: url, evidence_kind: 'direct',
  };
  const snapshot = {
    schemaVersion: 1, generatedAt: observed, sources: [source], history: [], discoveryRuns: [],
  };
  assert.deepEqual(snapshotIssues(snapshot), []);
  for (const evidence_url of invalidUrls.filter(value => !/[?#]/.test(value))) {
    assert.ok(snapshotIssues({ ...snapshot, sources: [{ ...source, evidence_url }] })
      .some(issue => issue.startsWith('unsafe-evidence-')));
  }
});
