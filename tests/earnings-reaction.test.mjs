import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
test('an after-hours or pre-market move of ±0.00% is left out, and a line without its value is not shown (owner, Nov 27)', () => {
  const at = '2026-11-12T21:10:00Z';
  const flat = { price: 100, percentChange: 3.2, asOf: at, session: 'post', extended: { price: 100, percentChange: 0.004, asOf: at, session: 'post' } };
  assert.deepEqual(reactionLines(flat, released).map(l => l.label), ['通常取引']);
  assert.deepEqual(reactionLines({ ...flat, extended: { ...flat.extended, percentChange: -0.0049 } }, released).map(l => l.label), ['通常取引']);
  assert.deepEqual(reactionLines({ ...flat, extended: { ...flat.extended, percentChange: 0.005 } }, released).map(l => l.label), ['通常取引', '時間外']);
  assert.deepEqual(reactionLines({ ...flat, percentChange: null, extended: { ...flat.extended, percentChange: undefined } }, released), []);
  assert.deepEqual(reactionLines({ ...flat, percentChange: undefined, asOf: undefined, extended: { price: 100, percentChange: 1.5, asOf: undefined, session: 'post' } }, released), []);
});
test('翌日の株価 only for the first session after the release; a later day is named by its date (owner, Nov 28)', async () => {
  const { reactionDay } = await import('../lib/research/earnings-reaction.ts');
  const dell = '2026-11-24T21:10:05Z'; // Tuesday after the close
  assert.equal(reactionDay('2026-11-25T20:59:00Z', dell), 'next');
  assert.equal(reactionDay('2026-11-27T18:00:00Z', dell), 'later');
  assert.equal(reactionDay('2026-11-24T20:00:00Z', '2026-11-24T12:00:00Z'), 'same', 'a release before the open moves the same day');
  assert.equal(reactionDay('2026-11-30T20:00:00Z', '2026-11-27T22:00:00Z'), 'next', 'Friday after the close: Monday');
  const card = readFileSync(new URL('../app/research/calendar/earnings-reaction.tsx', import.meta.url), 'utf8');
  assert.match(card, /"翌日の株価"/);
  assert.doesNotMatch(card, /JST時点|通常取引 <b/, 'one line, not the two 「通常取引 …（… JST時点）」 lines');
});
