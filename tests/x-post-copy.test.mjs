import test from 'node:test';
import assert from 'node:assert/strict';
import { buildXPost, forecastMark, guidanceRevision, oku, parseAmount, pickConsensus } from '../lib/research/x-post-copy.ts';

const f = (key, ja, value, comparisons) => ({ key, ja, en: key, value, ...(comparisons ? { comparisons } : {}) });
const crwv = { ticker: 'CRWV', period: '2026Q3', facts: [f('revenue', '売上高', '$3.661B', { yearAgo: '$1.365B' }), f('eps', 'EPS', '$-1.27'), f('net-income', '純利益', '$-709M'), f('guidance-revenue', '通期売上予想', '$13.0B-$13.3B')] };
const marked = text => text.split('\n').slice(2).filter(line => line && !line.startsWith('予想の提供')).every(line => /^(⭕️|❌|⚠️|✅)/.test(line));

test('amounts are read exactly and written in 億ドル', () => {
  assert.equal(parseAmount('$3.661B'), 3.661e9); assert.equal(parseAmount('$-709M'), -7.09e8); assert.equal(parseAmount('n/a'), null);
  assert.equal(oku(3.661e9), '36.61億ドル'); assert.equal(oku(-7.09e8), '7.09億ドル'); assert.equal(oku(1.325e11), '1,325億ドル');
});
test('【TICKER 決算速報】, a blank line, then one figure per line, each with a mark (owner, Nov 28)', () => {
  const text = buildXPost(crwv, null, 'short');
  assert.equal(text, '【CRWV 決算速報】\n\n✅売上高 36.61億ドル（前年比+168%）\n✅EPS -1.27ドル\n✅純損失 7.09億ドル\n✅通期売上予想 130〜133億ドル');
  assert.ok(marked(text));
  // the order is the same whatever order the release printed
  const shuffled = buildXPost({ ...crwv, facts: [crwv.facts[3], crwv.facts[2], crwv.facts[1], crwv.facts[0]] }, null, 'short');
  assert.equal(shuffled, text);
});
test('a previous-release value is never read as a year-ago value', () => {
  const text = buildXPost({ ticker: 'X', period: 'Q1', facts: [f('revenue', '売上高', '$3.661B', { previous: '$1.365B' })] }, null, 'short');
  assert.equal(text, '【X 決算速報】\n\n✅売上高 36.61億ドル');
});
test('the year-over-year change never decides a mark: a figure with only its year-ago change is ✅', () => {
  const text = buildXPost({ ticker: 'NBIS', period: '2026Q3', facts: [f('revenue', '売上高', '$980.8M', { yearAgo: '$146.1M' }), f('net-income', '純利益', '$-37.5M', { yearAgo: '$-119.6M' })] }, null, 'short');
  assert.doesNotMatch(text, /⭕|❌|⚠/);
  assert.ok(marked(text));
});
test('EPS against the market forecast: ⭕️ above, ❌ below, ✅ within ±1%; only on the EPS basis the forecast matched', () => {
  assert.deepEqual([forecastMark(1.2, 1), forecastMark(1.005, 1), forecastMark(0.995, 1), forecastMark(0.9, 1), forecastMark(-0.68, -0.86), forecastMark(-1.27, -1.1)],
    ['⭕️', '✅', '✅', '❌', '⭕️', '❌']);
  const c = { estimate: -1.1, date: '2026-11-12' };
  const text = buildXPost(crwv, c, 'short', 'eps');
  assert.match(text, /^【CRWV 決算速報】\n\n❌EPS -1\.27ドル（市場予想-1\.10ドル）\n✅売上高 36\.61億ドル/, '❌ comes before ✅');
  assert.match(text, /予想の提供: Twelve Data$/);
  assert.match(buildXPost({ ...crwv, facts: [f('eps', 'EPS', '$8.82')] }, { estimate: 8.1, date: 'd' }, 'short', 'eps'), /⭕️EPS 8\.82ドル（市場予想8\.10ドル）/);
  // NVDA: the consensus matched the adjusted EPS; the GAAP EPS is never compared with it
  const nvda = buildXPost({ ticker: 'NVDA', period: 'Q3 FY2027', facts: [f('eps', 'EPS（希薄化後）', '$2.70', { yearAgo: '$1.30' }), f('adjusted-eps', '調整後EPS（希薄化後）', '$2.68', { yearAgo: '$1.27' })] }, { estimate: 2.47, date: '2026-11-17' }, 'short', 'adjusted-eps');
  assert.equal(nvda, '【NVDA 決算速報】\n\n⭕️EPS（調整後） 2.68ドル（市場予想2.47ドル）\n✅EPS 2.70ドル（前年比+108%）\n\n予想の提供: Twelve Data');
});
test('figures in other currencies are written as printed', () => {
  assert.equal(buildXPost({ ticker: 'TSM', period: 'Q3 2026', facts: [f('revenue', '売上高', 'NT$1494.243B')] }, null, 'short'), '【TSM 決算速報】\n\n✅売上高 NT$1494.243B');
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

test('outlooks: ⭕️ raised, ❌ lowered, ⚠️ capital spending changed either way, ✅ new or unchanged; ⭕️ ❌ ⚠️ ✅ order', () => {
  const brief = { ticker: 'NBIS', period: '2026Q3', facts: [f('capex-guidance', '2026年の設備投資', '$27B', { priorGuidance: '$20B-$25B' }), f('revenue', '売上高', '$980.8M', { yearAgo: '$146.1M' })] };
  assert.equal(buildXPost(brief, null, 'short'), '【NBIS 決算速報】\n\n⚠️2026年の設備投資 270億ドル（従来予想200〜250億ドルを上回る）\n✅売上高 9.81億ドル（前年比+571%）');
  const lower = { ...brief, facts: [f('capex-guidance', '2026年の設備投資', '$18B', { priorGuidance: '$20B-$25B' })] };
  assert.match(buildXPost(lower, null, 'short'), /\n⚠️2026年の設備投資 180億ドル（従来予想200〜250億ドルを下回る）$/);
  const g = (value, prior) => buildXPost({ ticker: 'X', period: 'Q1', facts: [f('guidance-revenue', '通期見通し 売上高', value, prior ? { priorGuidance: prior } : undefined)] }, null, 'short');
  assert.match(g('$202.0B', '$192.0B'), /\n⭕️通期売上見通し 2,020億ドル（上方修正）$/, 'the mock line of Nov 28');
  assert.match(g('$2.0B-$2.4B', '$3.0B-$3.4B'), /\n❌通期売上見通し 20〜24億ドル（下方修正）$/);
  assert.match(g('$3.0B-$3.4B', '$3.0B-$3.4B'), /\n✅通期売上見通し 30〜34億ドル（据え置き）$/);
  assert.match(g('$3.0B-$3.4B'), /\n✅通期売上見通し 30〜34億ドル$/, 'a new outlook is ✅');
  assert.deepEqual([guidanceRevision('$3.2B-$3.6B', '$3.0B-$3.4B'), guidanceRevision('$130.0B ± 3%', '$120B')], ['up', null]);
  const order = buildXPost({ ticker: 'X', period: 'Q1', facts: [f('revenue', '売上高', '$1B'), f('eps', 'EPS', '$0.90'), f('guidance-fy-revenue', '通期見通し 売上高', '$5B', { priorGuidance: '$4B' }), f('capex-guidance', '設備投資', '$3B', { priorGuidance: '$2B' })] }, { estimate: 1, date: 'd' }, 'short', 'eps');
  assert.deepEqual(order.split('\n').slice(2, 6).map(line => line.slice(0, 1)), ['⭕', '❌', '⚠', '✅']);
});
