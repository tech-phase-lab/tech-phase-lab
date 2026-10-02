import assert from 'node:assert/strict';
import test from 'node:test';
import { publicPriceTargets, priceTargetSources, priceTargetSourceName } from '../lib/research/price-targets.ts';
import { GET } from '../app/api/research/price-targets/route.ts';

const primary = { id: 1, source: 'X · Market reporters', url: 'https://x.com/wallstengine/status/101', publishedAt: '2026-10-02T10:00:00Z', observedAt: '2026-10-02T10:00:01Z' };
const secondary = { id: 2, source: 'X · TipRanks', url: 'https://x.com/TipRanks/status/102', publishedAt: '2026-10-02T10:01:00Z', observedAt: '2026-10-02T10:01:01Z' };
const target = { ...primary, ticker: 'MU', firm: 'Citi', previous: 100, latest: 110 };
const payload = item => ({ ok: true, items: [item] });

test('target payload retains syndicated sources, primary identity, and only structured public fields', () => {
  const expected = { ...target, sources: [primary, secondary] };
  const feed = publicPriceTargets({ ...payload({ ...target, text: 'PRIVATE-BODY', sources: [{ ...primary, evidence: 'PRIVATE-EVIDENCE' }, secondary, secondary] }), token: 'PRIVATE-TOKEN' });
  assert.deepEqual(feed.items, [expected]);
  assert.equal(JSON.stringify(feed).includes('PRIVATE'), false);
  assert.deepEqual(priceTargetSources(feed.items[0]), [primary, secondary]);
  assert.deepEqual(priceTargetSources(target), [target]);
  assert.equal(priceTargetSourceName(primary), 'wallstengine');
  assert.equal(priceTargetSourceName(secondary), 'TipRanks');
});

test('invalid secondary sources cannot admit unapproved URLs or erase a valid target', () => {
  for (const url of ['javascript:alert(1)', 'https://evil.example/post', 'https://x.com/theflynews/status/103', 'https://x.com/impostor/status/103', 'https://x.com/TipRanks/status/103?secret=1']) {
    const feed = publicPriceTargets(payload({ ...target, sources: [{ ...secondary, url }] }));
    assert.deepEqual(feed.items, [{ ...target, sources: [primary] }]);
  }
});

test('target validation isolates malformed actions without merging distinct brokers or values', () => {
  const differentBroker = { ...target, id: 3, firm: 'UBS' };
  const correction = { ...target, id: 4, latest: 120 };
  const feed = publicPriceTargets({ ok: true, items: [{ ...target, previous: null }, target, differentBroker, correction] });
  assert.deepEqual(feed.items, [target, differentBroker, correction]);
  for (const changes of [{ id: -1 }, { url: 'https://x.com/impostor/status/1' }, { observedAt: '2026-10-02T09:00:00Z' }, { previous: Infinity }, { ticker: '$MU' }, { latest: 100 }]) {
    assert.deepEqual(publicPriceTargets(payload({ ...target, ...changes })).items, []);
  }
  assert.throws(() => publicPriceTargets({ ok: false, items: [] }));
  assert.throws(() => publicPriceTargets({ ok: true, items: Array(31).fill(target) }));
  assert.throws(() => publicPriceTargets({ ...payload(target), text: 'x'.repeat(100001) }), /Oversized/);
});

test('retains more than thirty evidence links when the full feed remains within its byte limit', () => {
  const sources = Array.from({ length: 35 }, (_, n) => ({ ...secondary, id: n + 2, url: `https://x.com/TipRanks/status/${n + 102}` }));
  const [item] = publicPriceTargets(payload({ ...target, sources })).items;
  assert.equal(item.sources.length, 36);
});

test('target API applies the same source projection as streamed client snapshots', async () => {
  const prior = { fetch: globalThis.fetch, url: process.env.RESEARCH_MONITOR_URL, token: process.env.RESEARCH_MONITOR_TOKEN };
  process.env.RESEARCH_MONITOR_URL = 'https://monitor.example.com';
  process.env.RESEARCH_MONITOR_TOKEN = 'synthetic-only';
  try {
    const raw = { ...payload({ ...target, sources: [primary, secondary], text: 'PRIVATE' }), debug: 'PRIVATE' };
    globalThis.fetch = async () => Response.json(raw);
    const response = await GET();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), publicPriceTargets(raw));
    process.env.RESEARCH_MONITOR_URL = 'https://user:secret@monitor.example.com';
    globalThis.fetch = async () => assert.fail('embedded credentials must be rejected');
    assert.equal((await GET()).status, 503);
  } finally {
    globalThis.fetch = prior.fetch;
    for (const [key, value] of [['RESEARCH_MONITOR_URL', prior.url], ['RESEARCH_MONITOR_TOKEN', prior.token]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
