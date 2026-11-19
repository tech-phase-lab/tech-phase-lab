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

test('a research note keeps its sections, scenarios, unknowns and next checks; an earlier analysis reads as sections without headings', () => {
  const note = { ...item, points: undefined, watch: null, releasedAt: '2026-11-19T21:20:00+00:00',
    headline: { ja: '増収は、粗利益率を保ったまま続くか。', en: 'Can growth continue while margin holds?' },
    summary: { ja: '要約', en: 'Summary' },
    sections: [{ heading: { ja: '採算', en: 'Margins' }, ja: '本文', en: 'Body' }, { heading: null, ja: '本文2', en: 'Body 2' }],
    scenarios: [{ case: 'base', ja: '…なら…', en: 'If …' }], unknowns: [{ ja: '不明', en: 'Unknown' }], next: [{ ja: '次', en: 'Next' }] };
  const [parsed] = parseDeepAnalyses({ items: [note] });
  assert.equal(parsed.sections[0].heading.ja, '採算');
  assert.equal(parsed.sections[1].heading, null);
  assert.deepEqual(parsed.points, [{ ja: '本文', en: 'Body' }, { ja: '本文2', en: 'Body 2' }]);
  assert.equal(parsed.scenarios[0].case, 'base');
  assert.equal(parsed.releasedAt, note.releasedAt);
  assert.equal(parseDeepAnalyses({ items: [{ ...note, scenarios: [{ case: 'buy', ja: 'x', en: 'x' }] }] }).length, 0);
  const [old] = parseDeepAnalyses({ items: [{ ...item, watch: { ja: '見る', en: 'Watch' } }] });
  assert.deepEqual(old.sections, item.points.map(point => ({ ...point, heading: null })));
  assert.deepEqual(old.next, [{ ja: '見る', en: 'Watch' }]);
  assert.equal(old.releasedAt, null);
  // one checked point is enough to publish (owner, Nov 15): the web no longer drops it
  assert.equal(parseDeepAnalyses({ items: [{ ...item, points: [item.points[0]] }] }).length, 1);
});

test('the analysis route checks PRO membership before contacting the monitor', () => {
  const route = readFileSync(new URL('../app/api/research/deep-analysis/route.ts', import.meta.url), 'utf8');
  assert.ok(route.indexOf('pro-required') < route.indexOf('RESEARCH_MONITOR_TOKEN'));
  assert.match(route, /"Cache-Control": "private, no-store"/);
});
