import test from 'node:test';
import assert from 'node:assert/strict';
import { FEAR_BOUNDARIES, FEAR_COPY, fearBand, fearMarkerPosition, formatFearPercent } from '../lib/resolute/fear-index.ts';

test('TP恐怖指数 bands: <15, 15–20, 20–30, ≥30; a boundary value belongs to the higher band', () => {
  assert.deepEqual([...FEAR_BOUNDARIES], [15, 20, 30]);
  const cases = [[0.1, 0], [12.3, 0], [14.99, 0], [15, 1], [18.6, 1], [19.99, 1], [20, 2], [25, 2], [29.99, 2], [30, 3], [41, 3], [90, 3]];
  for (const [value, band] of cases) assert.equal(fearBand(value), band, String(value));
});

test('▼ moves within its band and stops at the right end from 30 upward', () => {
  assert.equal(fearMarkerPosition(0), 0);
  assert.equal(fearMarkerPosition(7.5), 12.5);
  assert.equal(fearMarkerPosition(12.3), 20.5);
  assert.equal(fearMarkerPosition(15), 25);
  assert.equal(fearMarkerPosition(18.6), 43); // ふつう, right of centre
  assert.equal(fearMarkerPosition(20), 50);
  assert.equal(fearMarkerPosition(25), 62.5);
  assert.equal(fearMarkerPosition(29.9), 74.75);
  for (const value of [30, 41, 80, 1000]) assert.equal(fearMarkerPosition(value), 100, String(value));
  assert.equal(fearMarkerPosition(-3), 0);
  // The marker always stays inside the band that glows.
  for (let value = 0.1; value < 60; value += 0.37) {
    const position = fearMarkerPosition(value), band = fearBand(value);
    assert.ok(position >= band * 25 && position <= (band + 1) * 25, `${value} → ${position}`);
  }
});

test('the value is a percentage with one decimal', () => {
  assert.equal(formatFearPercent(18.6), '18.6%');
  assert.equal(formatFearPercent(18.6049), '18.6%');
  assert.equal(formatFearPercent(12.25), '12.3%');
  assert.equal(formatFearPercent(30), '30.0%');
  assert.equal(formatFearPercent(41), '41.0%');
});

test('wording in Japanese and English matches the owner spec', () => {
  assert.equal(FEAR_COPY.ja.title, 'TP恐怖指数');
  assert.deepEqual([...FEAR_COPY.ja.bands], ['落ち着いている', 'ふつう', '荒れ始めている', '大きく荒れている']);
  assert.equal(FEAR_COPY.ja.description, '相場がどれだけ荒れているかを表す数字です。VIX指数と同じ目盛りで見られて、数字が大きいほど荒れています。');
  assert.equal(FEAR_COPY.en.title, 'TP Fear Index');
  assert.deepEqual([...FEAR_COPY.en.bands], ['Calm', 'Normal', 'Getting rough', 'Very rough']);
  assert.equal(FEAR_COPY.en.description, 'Shows how rough the market is. It reads on the same scale as the VIX — the higher the number, the rougher the market.');
  for (const locale of ['ja', 'en']) {
    const copy = FEAR_COPY[locale];
    assert.deepEqual(copy.bandPhrases.map(p => p.join(locale === 'ja' ? '' : ' ')), [...copy.bands]);
    for (const text of [copy.title, copy.description, ...copy.bands]) assert.doesNotMatch(text, /…|\.\.\./);
  }
});
