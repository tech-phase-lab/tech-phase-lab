import test from 'node:test';
import assert from 'node:assert/strict';
import { publicNewsPayload, availableNewsPayload } from '../lib/research/general-news.ts';

const brief = { id: '1', researchId: 'x-result-1', kind: 'earnings', ticker: 'MU', period: 'Q4 2026', titleJa: 'MU決算', titleEn: 'MU earnings', facts: [{ key: 'revenue', ja: '売上高', en: 'Revenue', value: '$10B' }], url: 'https://x.com/wallstengine/status/101', publisher: 'Wall St Engine', publishedAt: '2026-10-02T10:00:00Z', observedAt: '2026-10-02T10:00:01Z', publicAt: '2026-10-02T10:00:02Z', processingMs: 1, sourceToDetectionMs: 1000, detectionToPublicMs: 1000 };
const other = { ...brief, id: '2', researchId: 'x-result-2', publisher: 'TipRanks', url: 'https://x.com/TipRanks/status/102' };
const source = b => ({ id: b.id, url: b.url, publisher: b.publisher, publishedAt: b.publishedAt, observedAt: b.observedAt });
const update = { id: brief.id, title: brief.titleEn, translationJa: brief.titleJa, url: brief.url, publisher: brief.publisher, tickers: ['MU'], observedAt: brief.observedAt, publishedAt: brief.publishedAt, researchId: brief.researchId, sources: [source(brief), source(other)] };
const payload = item => ({ ok: true, enabled: false, items: [], resultBriefs: [brief, other], officialUpdates: [item] });

test('merged result sources are reconstructed only from matching validated briefs', () => {
  for (const parse of [publicNewsPayload, availableNewsPayload]) {
    const result = parse(payload({ ...update, sources: [{ ...source(brief), text: 'PRIVATE-BODY', publisher: 'spoofed', publishedAt: 'bad' }, source(other), { id: '2', url: 'https://evil.example/post' }] }));
    assert.deepEqual(result.officialUpdates[0].sources, [source(brief), source(other)]);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.equal(JSON.stringify(result).includes('spoofed'), false);
  }
});

test('larger attributed result bodies require multiple fully validated sources', () => {
  const long = 'Verified attributed figures. '.repeat(500);
  const merged = publicNewsPayload(payload({ ...update, bodyJa: long, bodyEn: long })).officialUpdates[0];
  assert.equal(merged.bodyEn, long);
  const unverified = publicNewsPayload(payload({ ...update, sources: [{ id: 'unknown', url: 'https://evil.example/post' }], bodyJa: long, bodyEn: long })).officialUpdates[0];
  assert.equal(unverified.bodyEn, undefined);
  const oversized = publicNewsPayload(payload({ ...update, bodyJa: 'x'.repeat(40001), bodyEn: 'x'.repeat(40001) })).officialUpdates[0];
  assert.equal(oversized.bodyEn, undefined);
});
