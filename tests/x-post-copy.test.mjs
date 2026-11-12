import test from 'node:test';
import assert from 'node:assert/strict';
import { buildXPost, oku, parseAmount, pickConsensus } from '../lib/research/x-post-copy.ts';

const f = (key, ja, value, comparisons) => ({ key, ja, en: key, value, ...(comparisons ? { comparisons } : {}) });
const crwv = { ticker: 'CRWV', period: '2026Q3', facts: [f('revenue', '売上高', '$3.661B', { previous: '$1.365B' }), f('eps', 'EPS', '$-1.27'), f('net-income', '純利益', '$-709M'), f('guidance-revenue', '通期売上予想', '$13.0B-$13.3B')] };

test('amounts are read exactly and written in 億ドル', () => {
  assert.equal(parseAmount('$3.661B'), 3.661e9); assert.equal(parseAmount('$-709M'), -7.09e8); assert.equal(parseAmount('n/a'), null);
  assert.equal(oku(3.661e9), '36.61億ドル'); assert.equal(oku(-7.09e8), '7.09億ドル'); assert.equal(oku(1.325e11), '1,325億ドル');
});
test('short form follows the sample: ⭕ then ❌ then outlook, with YoY only when the prior value is known', () => {
  const text = buildXPost(crwv, null, 'short');
  assert.equal(text, 'CRWV 2026Q3 決算速報\n\n⭕️売上高36.61億ドル（前年比+168％）\n\n❌EPS-1.27ドル\n❌純損失7.09億ドル\n\n✅通期売上予想130〜133億ドル');
});
test('a figure without a known direction is neutral, never praised', () => {
  const text = buildXPost({ ticker: 'NBIS', period: '2026Q3', facts: [f('revenue', '売上高', '$582.3M')] }, null, 'short');
  assert.equal(text, 'NBIS 2026Q3 決算速報\n\n・売上高5.82億ドル');
});
test('consensus form adds the forecast and the attribution; short form never shows them', () => {
  const c = { estimate: -1.1, date: '2026-11-12' };
  assert.match(buildXPost(crwv, c, 'consensus'), /❌EPS-1.27ドル（予想-1.1ドル）[\s\S]*予想の提供: Twelve Data$/);
  assert.doesNotMatch(buildXPost(crwv, c, 'short'), /予想-1\.1|Twelve/);
  assert.match(buildXPost({ ...crwv, facts: [f('eps', 'EPS', '$-0.68')] }, { estimate: -0.86, date: 'd' }, 'consensus'), /⭕️EPS-0.68ドル（予想-0.86ドル）/);
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
