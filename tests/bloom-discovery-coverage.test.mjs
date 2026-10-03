import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverageCompanies, coverageCounts, latestDiscoveryRuns, providerByTicker } from '../lib/research/intake.ts';

const be = providerByTicker.BE;
const run = (id, index_url, status = 'ok', error = null) => ({
  id, ticker: 'BE', at: `2026-10-03T14:00:0${id}Z`, status, error,
  index_url, candidates: 1, source_format: index_url === be.indexUrl ? 'rss' : 'sec-json',
  sources_checked: 1, sources_configured: index_url === be.indexUrl ? 1 : 2,
});
const snapshot = discoveryRuns => ({ schemaVersion: 1, generatedAt: '2026-10-03T14:01:00Z',
  sources: [], history: [], discoveryRuns });
const coverage = runs => buildCoverageCompanies(snapshot(runs)).find(company => company.ticker === 'BE').discovery;

test('BE coverage remains incomplete until both independently collected phases have observations', () => {
  const partial = coverage([run(1, be.indexUrl)]);
  assert.equal(partial.status, 'degraded');
  assert.equal(partial.sourcesConfigured, 3);
  assert.equal(partial.sourcesChecked, 1);
  assert.equal(coverage([]).status, 'untested');
});

test('newer healthy Bloom RSS completion cannot hide failed SEC discovery', () => {
  const actual = coverage([run(3, be.indexUrl), run(2, be.supplementalSources[0].url, 'degraded', 'http-403')]);
  assert.equal(actual.status, 'degraded');
  assert.equal(actual.error, 'http-403');
  assert.equal(actual.checkedAt, '2026-10-03T14:00:03Z');
  assert.equal(actual.sourcesConfigured, 3);
});

test('newer SEC completion cannot hide failed Bloom RSS and healthy pair recovers', () => {
  const failed = coverage([run(3, be.supplementalSources[0].url), run(2, be.indexUrl, 'degraded', 'timeout')]);
  assert.equal(failed.status, 'degraded');
  assert.equal(failed.error, 'timeout');
  const healthy = coverage([run(4, be.indexUrl), run(3, be.supplementalSources[0].url), run(2, be.indexUrl, 'degraded', 'timeout')]);
  assert.equal(healthy.status, 'ok');
  assert.equal(healthy.error, null);
  assert.equal(healthy.candidates, 2);
  assert.equal(healthy.sourceFormat, 'rss+sec-json');
});

test('BE Atom fallback stays visible and unrelated issuers retain ordinary latest-run behavior', () => {
  assert.equal(coverage([run(3, be.indexUrl), run(2, be.supplementalSources[1].url, 'fallback')]).status, 'fallback');
  const runs = [
    { ...run(3, providerByTicker.MRVL.indexUrl), ticker: 'MRVL' },
    { ...run(2, providerByTicker.MRVL.indexUrl, 'degraded', 'timeout'), ticker: 'MRVL' },
  ];
  const mrvl = buildCoverageCompanies(snapshot(runs)).find(company => company.ticker === 'MRVL');
  assert.equal(mrvl.discovery.status, 'ok');
  assert.equal(mrvl.discovery.candidates, 1);
});


test('BE discovery counts and dashboard projection use the same durable phase health', () => {
  const data = snapshot([run(3, be.indexUrl), run(2, be.supplementalSources[0].url, 'degraded', 'http-403')]);
  assert.equal(coverageCounts(data).needsCheck, 1);
  assert.equal(coverageCounts(data).discovered, 0);
  const projected = latestDiscoveryRuns(data).find(row => row.ticker === 'BE');
  assert.equal(projected.status, 'degraded');
  assert.equal(projected.error, 'http-403');
  assert.equal(projected.sources_configured, 3);
});
