import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeepAnalyses } from '../lib/research/deep-analysis.ts';

const item = { id: '0123456789abcdef', kind: 'earnings', subject: 'NVDA', sourceUrl: 'https://nvidianews.nvidia.com/news/q3',
  sourceTitle: 'NVIDIA Announces Financial Results', publishedAt: '2026-11-19T21:30:00+00:00', model: 'gpt-6-astra',
  headline: { ja: '見出し', en: 'Headline' }, points: [{ ja: '一', en: 'One' }, { ja: '二', en: 'Two' }], watch: null };

test('deep analyses keep only well-formed items and drop the model name', () => {
  const [parsed] = parseDeepAnalyses({ items: [item, { ...item, id: 'bad' }, { ...item, points: [item.points[0]] },
    { ...item, sourceUrl: 'http://example.com' }, { ...item, headline: { ja: '', en: 'x' } }] });
  assert.equal(parseDeepAnalyses({ items: [item, { ...item, id: 'bad' }] }).length, 1);
  assert.equal(parsed.model, undefined);
  assert.deepEqual(parsed.points, item.points);
  assert.throws(() => parseDeepAnalyses({ items: 'x' }));
});

test('the analysis route checks PRO membership before contacting the monitor', () => {
  const route = readFileSync(new URL('../app/api/research/deep-analysis/route.ts', import.meta.url), 'utf8');
  assert.ok(route.indexOf('pro-required') < route.indexOf('RESEARCH_MONITOR_TOKEN'));
  assert.match(route, /"Cache-Control": "private, no-store"/);
});
