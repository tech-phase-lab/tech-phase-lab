// Supplied Claude tests, adapted to the repository Node test runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateDrop, simulateSurge, roundMoney } from "../lib/resolute/simulate.ts";
const plan = {
  currency: "JPY",
  monthlyExpenses: 25e4,
  tolerableLoss: 1e6,
  singleStockCapPct: 30,
  buyLines: [
    { dropPct: 20, amount: 2e5 },
    { dropPct: 10, amount: 1e5 },
    { dropPct: 30, amount: 3e5 }
  ]
};
test("\u4E0B\u843D: 500\u4E07\u5186\u304C20%\u4E0B\u304C\u308B \u2192 \u640D\u5931100\u4E07\u5186\u3001\u751F\u6D3B\u8CBB4.0\u304B\u6708\u5206\u3001\u8A31\u5BB9\u984D\u3061\u3087\u3046\u3069\u306F\u7BC4\u56F2\u5185", () => {
  const r = simulateDrop(plan, 5e6, 20);
  assert.equal(r.lossAmount, 1e6);
  assert.equal(r.monthsOfExpenses, 4);
  assert.equal(r.withinTolerance, true);
  assert.equal(r.valueAfter, 4e6);
});
test("\u4E0B\u843D: \u8A31\u5BB9\u984D\u3092\u8D85\u3048\u308B\u3068\u7BC4\u56F2\u5916", () => {
  assert.equal(simulateDrop(plan, 5e6, 20.1).withinTolerance, false);
});
test("\u4E0B\u843D: \u30E9\u30A4\u30F3\u5230\u9054\u306F\u6D45\u3044\u9806\u3002\u3061\u3087\u3046\u3069\u306E\u6BB5\u968E\u3082\u542B\u3080", () => {
  const r = simulateDrop(plan, 5e6, 20);
  assert.deepEqual(r.reachedLines.map((l) => l.dropPct), [10, 20]);
  assert.equal(r.plannedBuyTotal, 3e5);
});
test("\u4E0B\u843D: 0%\u3068100%\u306E\u5883\u754C", () => {
  const zero = simulateDrop(plan, 5e6, 0);
  assert.equal(zero.lossAmount, 0);
  assert.equal(zero.reachedLines.length, 0);
  const all = simulateDrop(plan, 5e6, 100);
  assert.equal(all.valueAfter, 0);
  assert.equal(all.reachedLines.length, 3);
});
test("\u4E0B\u843D: \u751F\u6D3B\u8CBB0\u306F\u6708\u6570\u304Cnull\u3002\u7BC4\u56F2\u5916\u306E\u5165\u529B\u306F\u30A8\u30E9\u30FC", () => {
  assert.equal(simulateDrop({ ...plan, monthlyExpenses: 0 }, 1e6, 10).monthsOfExpenses, null);
  assert.throws(() => simulateDrop(plan, 1e6, 101), RangeError);
  assert.throws(() => simulateDrop(plan, 1e6, -1), RangeError);
  assert.throws(() => simulateDrop(plan, -1, 10), RangeError);
  assert.throws(() => simulateDrop(plan, Number.NaN, 10), RangeError);
});
test("\u4E38\u3081: \u5186\u306F\u5207\u308A\u6368\u3066\u3001\u30C9\u30EB\u306F\u5C0F\u65702\u6841\u306B\u5207\u308A\u6368\u3066", () => {
  assert.equal(roundMoney(1234.99, "JPY"), 1234);
  assert.equal(roundMoney(12.349, "USD"), 12.34);
  const usd = { ...plan, currency: "USD", monthlyExpenses: 3e3, tolerableLoss: 1e4 };
  const r = simulateDrop(usd, 33333.33, 10);
  assert.equal(r.lossAmount, 3333.33);
});
test("\u6025\u9A30: \u4E0A\u9650\u5272\u5408\u3092\u8D85\u3048\u305F\u9298\u67C4\u3092\u51FA\u3059", () => {
  const r = simulateSurge(plan, [
    { name: "A", value: 3e5 },
    { name: "B", value: 7e5 }
  ], 0, { A: 100 });
  assert.equal(r.totalAfter, 13e5);
  assert.deepEqual(r.overCapNames, ["A", "B"]);
});
test("\u6025\u9A30: \u4E0A\u9650\u3061\u3087\u3046\u3069\u306F\u8D85\u904E\u306B\u3057\u306A\u3044", () => {
  const r = simulateSurge(plan, [
    { name: "A", value: 300 },
    { name: "B", value: 700 }
  ], 0);
  assert.deepEqual(r.overCapNames, ["B"]);
  assert.equal(r.items[0].overCap, false);
});
test("\u6025\u9A30: \u4FDD\u6709\u306A\u3057\u306F\u5272\u54080\u3002-100%\u672A\u6E80\u306F\u30A8\u30E9\u30FC", () => {
  assert.equal(simulateSurge(plan, [], 10).totalAfter, 0);
  assert.throws(() => simulateSurge(plan, [{ name: "A", value: 1 }], -101), RangeError);
});
test("\u4E0B\u843D: \u4E38\u3081\u308B\u524D\u306E\u984D\u3067\u8A31\u5BB9\u984D\u3068\u6BD4\u3079\u308B(1\u5186\u672A\u6E80\u306E\u8D85\u904E\u3092\u898B\u9003\u3055\u306A\u3044)", () => {
  const p = { ...plan, tolerableLoss: 1e5 };
  const r = simulateDrop(p, 1000001, 10);
  assert.equal(r.lossAmount, 1e5);
  assert.equal(r.withinTolerance, false);
});
test("\u4E0B\u843D: \u6D6E\u52D5\u5C0F\u6570\u70B9\u306E\u305A\u308C\u3067\u30E9\u30A4\u30F3\u3092\u898B\u9003\u3055\u306A\u3044", () => {
  const p = { ...plan, buyLines: [{ dropPct: 30, amount: 1 }] };
  assert.equal(simulateDrop(p, 1e6, 29.999999999999996).reachedLines.length, 1);
});
test("\u5165\u529B: \u30E9\u30A4\u30F3\u30FB\u4E0A\u9650\u5272\u5408\u306E\u4E0D\u6B63\u5024\u306F\u30A8\u30E9\u30FC", () => {
  assert.throws(() => simulateDrop({ ...plan, buyLines: [{ dropPct: 10, amount: Number.NaN }] }, 1, 10), RangeError);
  assert.throws(() => simulateDrop({ ...plan, buyLines: [{ dropPct: 10, amount: -1 }] }, 1, 10), RangeError);
  assert.throws(() => simulateDrop({ ...plan, buyLines: [{ dropPct: 150, amount: 1 }] }, 1, 10), RangeError);
  assert.throws(() => simulateDrop({ ...plan, singleStockCapPct: -1 }, 1, 10), RangeError);
});
