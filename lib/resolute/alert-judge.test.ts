import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, buildDigest, type WatchItem, type Close } from './alert-judge.ts';

const item: WatchItem = { symbol: 'AAA', referencePrice: 100, lines: [10, 20, 30], surgeCapPct: 50 };
const close = (price: number, over: Partial<Close> = {}): Close => ({
  symbol: 'AAA', date: '2027-01-20', close: price, isFinal: true, ...over,
});

test('ラインちょうどで到達。浅い順に新規ラインを返す', () => {
  const r = judge([item], [close(80)], {});
  assert.equal(r.events.length, 1);
  assert.deepEqual(r.events[0].newLines, [10, 20]);
  assert.equal(r.events[0].dropPct, 20);
});

test('ラインに届かなければ通知なし', () => {
  const r = judge([item], [close(95)], {});
  assert.equal(r.events.length, 0);
});

test('同じラインは翌日以降に再通知しない。新しいラインだけ通知', () => {
  const day1 = judge([item], [close(88)], {});
  assert.deepEqual(day1.events[0].newLines, [10]);
  const day2 = judge([item], [close(87)], day1.nextState);
  assert.equal(day2.events.length, 0);
  const day3 = judge([item], [close(79)], day2.nextState);
  assert.deepEqual(day3.events[0].newLines, [20]);
});

test('再通知の設定オン: 価格が戻ったあとで再び下がれば、もう一度通知する', () => {
  const on = { ...item, renotifyAfterRecovery: true };
  const d1 = judge([on], [close(88)], {});
  const d2 = judge([on], [close(95)], d1.nextState);
  assert.equal(d2.events.length, 0);
  const d3 = judge([on], [close(89)], d2.nextState);
  assert.deepEqual(d3.events[0].newLines, [10]);
});

test('再通知の設定オフ(初期値): 戻ってから再び下がっても、同じラインは通知しない', () => {
  const d1 = judge([item], [close(88)], {});
  const d2 = judge([item], [close(95)], d1.nextState);
  const d3 = judge([item], [close(89)], d2.nextState);
  assert.equal(d3.events.length, 0);
  const d4 = judge([item], [close(79)], d3.nextState);
  assert.deepEqual(d4.events[0].newLines, [20]);
});

test('終値が未確定なら判定しない(状態も変えない)', () => {
  const r = judge([item], [close(50, { isFinal: false })], {});
  assert.equal(r.events.length, 0);
  assert.deepEqual(r.skipped, [{ symbol: 'AAA', reason: 'not_final' }]);
  assert.deepEqual(r.nextState, {});
});

test('終値なし・不正な値はスキップ', () => {
  assert.deepEqual(judge([item], [], {}).skipped, [{ symbol: 'AAA', reason: 'no_close' }]);
  assert.deepEqual(judge([item], [close(Number.NaN)], {}).skipped[0].reason, 'invalid_input');
  assert.deepEqual(judge([{ ...item, referencePrice: 0 }], [close(50)], {}).skipped[0].reason, 'invalid_input');
});

test('急騰: 上限に達した日に1回だけ。戻れば再び対象', () => {
  const d1 = judge([item], [close(150)], {});
  assert.equal(d1.events[0].kind, 'surge_cap');
  assert.equal(d1.events[0].risePct, 50);
  const d2 = judge([item], [close(160)], d1.nextState);
  assert.equal(d2.events.length, 0);
  const d3 = judge([item], [close(120)], d2.nextState);
  const d4 = judge([item], [close(155)], d3.nextState);
  assert.equal(d4.events.length, 1);
});

test('入力の状態を書き換えない', () => {
  const state = { AAA: { lines: [10], surge: false } };
  const copy = JSON.stringify(state);
  judge([item], [close(70)], state);
  assert.equal(JSON.stringify(state), copy);
});

test('まとめ: 1人1日1通。複数銘柄を1通に。冪等キーはユーザー+日付+種類', () => {
  const items: WatchItem[] = [item, { ...item, symbol: 'BBB' }];
  const r = judge(items, [close(85), { ...close(85), symbol: 'BBB' }], {});
  const d = buildDigest({ userId: 'user_1', date: '2027-01-20', locale: 'ja', events: r.events });
  assert.ok(d);
  assert.equal(d.payload.items.length, 2);
  assert.equal(d.idempotencyKey, 'user_1:2027-01-20:alerts');
  assert.equal(d.kind, 'line_reached');
  assert.deepEqual(d.payload.items.map((i) => i.symbol), ['AAA', 'BBB']);
});

test('まとめ: 下落と急騰が混ざれば下落を先に。該当なしはnull', () => {
  const r = judge([item, { ...item, symbol: 'ZZZ' }], [close(85), { ...close(160), symbol: 'ZZZ' }], {});
  const d = buildDigest({ userId: 'u', date: '2027-01-20', locale: 'en', events: r.events });
  assert.equal(d?.kind, 'line_reached');
  assert.equal(d?.payload.items[0].kind, 'line_reached');
  assert.equal(buildDigest({ userId: 'u', date: 'x', locale: 'en', events: [] }), null);
});

test('ラインの入力が不正でも壊れない: 重複・0以下は無視する', () => {
  const r = judge([{ ...item, lines: [10, 10, 0, -5] }], [close(85)], {});
  assert.deepEqual(r.events[0].newLines, [10]);
  const up = judge([{ ...item, lines: [0, -5] }], [close(101)], {});
  assert.equal(up.events.length, 0);
});

test('基準価格が無限大・終値が0以下はスキップ', () => {
  assert.equal(judge([{ ...item, referencePrice: Infinity }], [close(50)], {}).skipped[0].reason, 'invalid_input');
  assert.equal(judge([item], [close(0)], {}).skipped[0].reason, 'invalid_input');
});
