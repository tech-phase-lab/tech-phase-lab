import test from 'node:test';
import assert from 'node:assert/strict';
import { buildXPost, forecastMark, oku, parseAmount, pickConsensus } from '../lib/research/x-post-copy.ts';

const f = (key, ja, value, comparisons) => ({ key, ja, en: key, value, ...(comparisons ? { comparisons } : {}) });
const crwv = { ticker: 'CRWV', period: '2026Q3', facts: [f('revenue', '売上高', '$3.661B', { yearAgo: '$1.365B' }), f('eps', 'EPS', '$-1.27'), f('net-income', '純利益', '$-709M'), f('guidance-revenue', '通期売上予想', '$13.0B-$13.3B')] };

test('amounts are read exactly and written in 億ドル', () => {
  assert.equal(parseAmount('$3.661B'), 3.661e9); assert.equal(parseAmount('$-709M'), -7.09e8); assert.equal(parseAmount('n/a'), null);
  assert.equal(oku(3.661e9), '36.61億ドル'); assert.equal(oku(-7.09e8), '7.09億ドル'); assert.equal(oku(1.325e11), '1,325億ドル');
});
test('one figure per line in one order for every company; no mark without a forecast (owner, Nov 18)', () => {
  const text = buildXPost(crwv, null, 'short');
  assert.equal(text, 'CRWV 2026Q3 決算速報\n\n売上高36.61億ドル（前年比+168％）\nEPS-1.27ドル\n純損失7.09億ドル\n通期売上予想130〜133億ドル');
  // the order is the same whatever order the release printed
  const shuffled = buildXPost({ ...crwv, facts: [crwv.facts[3], crwv.facts[2], crwv.facts[1], crwv.facts[0]] }, null, 'short');
  assert.equal(shuffled, text);
});
test('a previous-release value is never read as a year-ago value', () => {
  const text = buildXPost({ ticker: 'X', period: 'Q1', facts: [f('revenue', '売上高', '$3.661B', { previous: '$1.365B' })] }, null, 'short');
  assert.equal(text, 'X Q1 決算速報\n\n売上高36.61億ドル');
});
test('the year-over-year change never decides a mark', () => {
  const text = buildXPost({ ticker: 'NBIS', period: '2026Q3', facts: [f('revenue', '売上高', '$980.8M', { yearAgo: '$146.1M' }), f('net-income', '純利益', '$-37.5M', { yearAgo: '$-119.6M' })] }, null, 'short');
  assert.doesNotMatch(text, /[○△✕⭕❌]/);
});
test('marks: ○ above the forecast, △ within ±1%, ✕ below; only on the figure that has a forecast', () => {
  assert.deepEqual([forecastMark(1.2, 1), forecastMark(1.005, 1), forecastMark(0.995, 1), forecastMark(0.9, 1), forecastMark(-0.68, -0.86), forecastMark(-1.27, -1.1)],
    ['○', '△', '△', '✕', '○', '✕']);
  const c = { estimate: -1.1, date: '2026-11-12' };
  const text = buildXPost(crwv, c, 'consensus');
  assert.match(text, /\n✕EPS-1.27ドル（予想-1.1ドル）\n/);
  assert.match(text, /\n\n売上高36.61億ドル/);
  assert.match(text, /予想の提供: Twelve Data$/);
  assert.doesNotMatch(buildXPost(crwv, c, 'short'), /予想-1\.1|Twelve/);
  assert.match(buildXPost({ ...crwv, facts: [f('eps', 'EPS', '$-0.68')] }, { estimate: -0.86, date: 'd' }, 'consensus'), /○EPS-0.68ドル（予想-0.86ドル）/);
});
test('figures in other currencies are written as printed', () => {
  assert.equal(buildXPost({ ticker: 'TSM', period: 'Q3 2026', facts: [f('revenue', '売上高', 'NT$1494.243B')] }, null, 'short'), 'TSM Q3 2026 決算速報\n\n売上高NT$1494.243B');
});
test('unreadable values are omitted, and nothing is written when nothing is readable', () => {
  assert.equal(buildXPost({ ticker: 'X', period: 'Q1', facts: [f('revenue', '売上高', 'n/a')] }, null, 'short'), null);
});
test('consensus is used only for the matching report date and the same EPS basis; provider surprise_prc is ignored', () => {
  const raw = { earnings: [{ date: '2026-08-12', eps_estimate: -0.86, eps_actual: -0.68, surprise_prc: -20.93 }, { date: '2026-11-12', eps_estimate: -1.1, eps_actual: -1.27 }] };
  assert.deepEqual(pickConsensus(raw, '2026-11-12T13:00:00Z', -1.27), { estimate: -1.1, date: '2026-11-12' });
  assert.equal(pickConsensus(raw, '2026-11-12T13:00:00Z', -0.9), null); // other basis
  assert.equal(pickConsensus(raw, '2026-12-30T13:00:00Z', -1.27), null); // no row for that date
  assert.equal(pickConsensus({ earnings: [{ date: '2026-11-12', eps_estimate: 1, eps_actual: null }] }, '2026-11-12T13:00:00Z', 1), null);
});

test('outlook lines keep their wording against the old outlook, without a mark', () => {
  const brief = { ticker: 'NBIS', period: '2026Q3', facts: [f('capex-guidance', '2026年設備投資見通し', '$27B', { priorGuidance: '$20B-$25B' }), f('revenue', '売上高', '$980.8M', { yearAgo: '$146.1M' })] };
  assert.equal(buildXPost(brief, null, 'short'), 'NBIS 2026Q3 決算速報\n\n売上高9.81億ドル（前年比+571％）\n2026年設備投資見通し270億ドル（従来予想200〜250億ドルを上回る）');
  const g = (value, prior) => buildXPost({ ticker: 'X', period: 'Q1', facts: [f('guidance-revenue', '通期売上予想', value, prior ? { priorGuidance: prior } : undefined)] }, null, 'short');
  assert.match(g('$3.5B-$3.8B', '$3.0B-$3.4B'), /\n通期売上予想35〜38億ドル（従来予想30〜34億ドルを上方修正）$/);
  assert.match(g('$2.0B-$2.4B', '$3.0B-$3.4B'), /下方修正）$/);
  assert.match(g('$3.0B-$3.4B'), /\n通期売上予想30〜34億ドル$/);
});
