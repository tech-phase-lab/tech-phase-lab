import test from 'node:test';
import assert from 'node:assert/strict';
import { reactionLines, percentText } from '../lib/research/earnings-reaction.ts';

const released = '2026-11-12T13:00:00Z';
test('only moves stamped at or after the release are shown', () => {
  const quote = { price: 100, percentChange: 2.5, asOf: '2026-11-12T12:59:00Z', session: 'closed', extended: { price: 105, percentChange: 5, asOf: '2026-11-12T13:20:00Z', session: 'pre' } };
  assert.deepEqual(reactionLines(quote, released).map(l => [l.label, l.percent, l.base]), [['プレマーケット', 5, '通常取引の終値比']]);
});
test('regular-session move after the release is labelled as a move from the previous close; nothing qualifying gives no lines', () => {
  const quote = { price: 90, percentChange: -7.1, asOf: '2026-11-12T14:45:00Z', session: 'regular' };
  assert.deepEqual(reactionLines(quote, released).map(l => [l.label, l.base]), [['通常取引', '前日終値比']]);
  assert.deepEqual(reactionLines({ ...quote, asOf: '2026-11-11T21:00:00Z' }, released), []);
  assert.deepEqual(reactionLines(null, released), []);
  assert.equal(percentText(-7.1), '-7.10%'); assert.equal(percentText(5), '+5.00%');
});
