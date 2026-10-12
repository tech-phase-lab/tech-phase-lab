// Supplied Claude tests, adapted to the repository Node test runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcAmounts,
  buildBuyLines,
  decideType,
  diagnose,
  pickAdvice,
  formatYen,
  scoreTypes
} from "../lib/resolute/diagnosis.ts";
const base = (over = {}, answers = {}) => ({
  monthlyLivingCost: 25e4,
  savingsMonths: 6,
  reserveMonths: 6,
  nearTermExpense: 2e6,
  financialAssets: 1e7,
  investedAmount: 3e6,
  tolerancePct: 20,
  perStockCapPct: 20,
  firstDropPct: 10,
  buyBudgetPct: 20,
  noBuyConditions: [],
  haltConditions: [],
  fx: { thresholdYen: null },
  ...over,
  answers: { q24: "steps3", q27: "equal", ...answers }
});
test("\u901A\u5E38: \u6E96\u5099\u984D\u30FB\u56DE\u305B\u308B\u984D\u30FB\u8A31\u5BB9\u984D", () => {
  const m = calcAmounts(base());
  assert.equal(m.reserve, 15e5);
  assert.equal(m.investable, 65e5);
  assert.equal(m.investBase, 3e6);
  assert.equal(m.toleranceDrop, 6e5);
  assert.equal(m.toleranceMonths, 2.4);
  assert.equal(m.perStockCapAmount, 6e5);
  assert.equal(m.buyBudget, 6e5);
});
test("\u91D1\u878D\u8CC7\u7523\u304C\u4E0D\u660E\u306A\u3089\u56DE\u305B\u308B\u984D\u306Fnull\u3001\u6295\u8CC7\u6E08\u307F\u3067\u8A31\u5BB9\u984D\u306F\u51FA\u308B", () => {
  const m = calcAmounts(base({ financialAssets: null }));
  assert.equal(m.investable, null);
  assert.equal(m.investBase, 3e6);
  assert.equal(m.toleranceDrop, 6e5);
});
test("\u5168\u90E8\u672A\u56DE\u7B54\u306A\u3089null", () => {
  const m = calcAmounts(base({ financialAssets: null, investedAmount: null }));
  assert.equal(m.investable, null);
  assert.equal(m.investBase, null);
  assert.equal(m.toleranceDrop, null);
  assert.equal(m.buyBudget, null);
});
test("\u56DE\u305B\u308B\u984D\u304C\u30BC\u30ED\u3001\u6295\u8CC7\u6E08\u307F\u306A\u3057\u306A\u3089\u57FA\u6E96\u984D\u30820", () => {
  const m = calcAmounts(base({ financialAssets: 3e6, investedAmount: null }));
  assert.equal(m.investable, 0);
  assert.equal(m.investBase, 0);
  assert.equal(m.toleranceDrop, 0);
  assert.equal(m.buyBudget, 0);
});
test("\u7AEF\u6570\u306F\u5207\u308A\u6368\u3066(\u5C0F\u65701\u6841\u306E\u6708\u6570\u30FB\u5272\u5408)", () => {
  const m = calcAmounts(base({ reserveMonths: 2.5, tolerancePct: 12.5, investedAmount: 1000001 }));
  assert.equal(m.reserve, 625e3);
  assert.equal(m.toleranceDrop, Math.floor(1000001 * 125 / 1e3));
});
test("\u8CB7\u3044\u5897\u3057: \u5747\u7B49\u306F\u5408\u8A08\u304C\u4E88\u7B97\u306B\u4E00\u81F4\u3057\u3001\u5E45\u306F1\u6BB5\u968E\u76EE\u3068\u540C\u3058", () => {
  const i = base({ investedAmount: 1e6, buyBudgetPct: 10 }, { q24: "steps3", q27: "equal" });
  const lines = buildBuyLines(i, calcAmounts(i));
  assert.deepEqual(lines.map((l) => l.dropPct), [10, 20, 30]);
  assert.equal(lines.reduce((s, l) => s + l.amount, 0), 1e5);
  assert.deepEqual(lines.map((l) => l.amount), [33333, 33333, 33334]);
});
test("\u8CB7\u3044\u5897\u3057: \u4E0B\u304C\u308B\u307B\u3069\u591A\u3081(1:2:3)", () => {
  const i = base({ investedAmount: 12e5, buyBudgetPct: 10 }, { q24: "steps3", q27: "heavier" });
  const lines = buildBuyLines(i, calcAmounts(i));
  assert.deepEqual(lines.map((l) => l.amount), [2e4, 4e4, 6e4]);
});
test("\u8CB7\u3044\u5897\u3057: \u5206\u3051\u306A\u3044(1\u56DE\u3067)\u306F1\u884C\u3001\u3057\u306A\u3044\u306F\u7A7A", () => {
  const i1 = base({}, { q24: "single", q27: null });
  assert.equal(buildBuyLines(i1, calcAmounts(i1)).length, 1);
  const i2 = base({ firstDropPct: null, buyBudgetPct: null }, { q24: "none", q27: null });
  assert.deepEqual(buildBuyLines(i2, calcAmounts(i2)), []);
});
test("\u30BF\u30A4\u30D7: \u56DE\u305B\u308B\u984D0\u5186\u306F\u5FC5\u305A\u571F\u53F0\u3065\u304F\u308A\u578B", () => {
  const i = base({ financialAssets: 3e6, investedAmount: null }, { q16: "fast", q13: "wait" });
  assert.equal(decideType(i, calcAmounts(i)), "foundation");
});
test("\u30BF\u30A4\u30D7: \u52E2\u3044\u3067\u52D5\u304D\u3084\u3059\u3044\u578B", () => {
  const i = base({}, { q19: "often", q17: "news", q18: "many_daily", q14: "often" });
  assert.equal(decideType(i, calcAmounts(i)), "impulsive");
});
test("\u30BF\u30A4\u30D7: \u96C6\u4E2D\u52DD\u8CA0\u578B", () => {
  const i = base({ perStockCapPct: 50 }, { q20: "stock", q23: "gt50", q21: ["tech_semis"] });
  assert.equal(decideType(i, calcAmounts(i)), "concentrated");
});
test("\u30BF\u30A4\u30D7: \u30B3\u30C4\u30B3\u30C4\u7A4D\u307F\u4E0A\u3052\u578B", () => {
  const i = base({}, { q16: "steady", q17: "monthly", q09: "y10plus" });
  assert.equal(decideType(i, calcAmounts(i)), "steady");
});
test("\u30BF\u30A4\u30D7: \u3053\u308C\u304B\u3089\u935B\u3048\u308B\u578B", () => {
  const i = base({}, { q01: "first", q10: "no_drop_yet", q12: "no_drop_yet", q14: "no_rally_yet" });
  assert.equal(decideType(i, calcAmounts(i)), "learner");
});
test("\u30BF\u30A4\u30D7: 2\u70B9\u4EE5\u4E0B\u306A\u3089\u30D0\u30E9\u30F3\u30B9\u578B", () => {
  const i = base({ perStockCapPct: 20, tolerancePct: 20, buyBudgetPct: 10 }, { q24: "none", q16: "undecided" });
  const m = calcAmounts(i);
  const s = scoreTypes(i, m);
  assert.ok(Math.max(...Object.values(s)) <= 2);
  assert.equal(decideType(i, m), "balanced");
});
test("\u30BF\u30A4\u30D7: \u540C\u70B9\u306F\u8868\u306E\u4E0A\u306E\u30BF\u30A4\u30D7", () => {
  const i = base({}, { q19: "often", q14: "once", q13: "reduce", q10: "often" });
  const s = scoreTypes(i, calcAmounts(i));
  assert.equal(s.impulsive, 3);
  assert.equal(s.defensive, 3);
  assert.equal(decideType(i, calcAmounts(i)), "impulsive");
});
test("\u30A2\u30C9\u30D0\u30A4\u30B9: \u5F53\u3066\u306F\u307E\u3089\u306A\u3051\u308C\u3070\u65E2\u5B9A\u6587\u3001\u6700\u59275\u3064", () => {
  const i = base({ noBuyConditions: ["x"], haltConditions: ["y"], tolerancePct: 40 }, { q09: "y10plus" });
  const adv = pickAdvice(i, calcAmounts(i));
  assert.equal(adv.length, 1);
  assert.equal(adv[0].id, "default");
  const many = base({ tolerancePct: 10 }, {
    q03: "none",
    q06: "has",
    q09: "y3to5",
    q10: "often",
    q12: "yes",
    q14: "often",
    q19: "often",
    q18: "many_daily"
  });
  const adv2 = pickAdvice(many, calcAmounts(many));
  assert.equal(adv2.length, 5);
});
test("\u30A2\u30C9\u30D0\u30A4\u30B9: \u6570\u5B57\u304C\u6587\u4E2D\u306B\u5165\u308A\u3001\u672A\u5165\u529B\u306E\u3068\u304D\u306F\u51FA\u3055\u306A\u3044", () => {
  const i = base({ tolerancePct: 10 }, {});
  const t = pickAdvice(i, calcAmounts(i)).find((a) => a.id === "tolerance_p10");
  assert.ok(t?.text.includes("30\u4E07\u5186"));
  const j = base({ tolerancePct: null, investedAmount: null, financialAssets: null }, {});
  assert.ok(!pickAdvice(j, calcAmounts(j)).some((a) => a.id === "tolerance_p10"));
});
test("\u30A2\u30C9\u30D0\u30A4\u30B9: 30%\u4E0B\u843D\u304C\u8A31\u5BB9\u984D\u3092\u8D85\u3048\u308B\u5834\u5408\u306F\u91D1\u984D\u5165\u308A\u3067\u8AAC\u660E", () => {
  const i = base({ tolerancePct: 20 }, {});
  const t = pickAdvice(i, calcAmounts(i)).find((a) => a.id === "drop30_over_tolerance");
  assert.ok(t);
  assert.ok(t.text.includes("90\u4E07\u5186") && t.text.includes("60\u4E07\u5186"));
});
test("\u30A2\u30C9\u30D0\u30A4\u30B9: \u4E00\u756A\u591A\u3044\u9298\u67C4\u304C\u4E0A\u9650\u8D85\u3048", () => {
  const i = base({ perStockCapPct: 20 }, { q23: "p30to50" });
  assert.ok(pickAdvice(i, calcAmounts(i)).some((a) => a.id === "top_over_cap"));
  const j = base({ perStockCapPct: 30 }, { q23: "p10to30" });
  assert.ok(!pickAdvice(j, calcAmounts(j)).some((a) => a.id === "top_over_cap"));
});
test("\u7D50\u679C\u306E\u753B\u9762: 7\u884C\u3001\u91D1\u878D\u8CC7\u7523\u4E0D\u660E\u306F\u8A08\u7B97\u3067\u304D\u307E\u305B\u3093\u3001\u70BA\u66FF\u306E\u6587\u8A00", () => {
  const i = base({ financialAssets: null, fx: { thresholdYen: 3 } }, { q28: ["cash_low", "no_reason"], q29: ["over_tolerance"] });
  const r = diagnose(i);
  assert.equal(r.rows.length, 7);
  assert.equal(r.rows[0].rule, "\u8A08\u7B97\u3067\u304D\u307E\u305B\u3093");
  assert.equal(r.rows[4].rule, "\u8CAF\u91D1\u304C\u6E1B\u3063\u305F\u3068\u304D / \u8CB7\u3046\u7406\u7531\u3092\u8AAC\u660E\u3067\u304D\u306A\u3044\u3068\u304D");
  assert.equal(r.rows[6].rule, "\u30C9\u30EB\u5186\u304C3\u5186\u52D5\u3044\u305F\u3089\u3001\u30EB\u30FC\u30EB\u3092\u8AAD\u307F\u76F4\u3059");
  assert.ok(r.disclaimer.includes("\u58F2\u8CB7\u3092\u3059\u3059\u3081\u308B\u3082\u306E\u3067\u306F\u3042\u308A\u307E\u305B\u3093"));
});
test("\u7D50\u679C\u306E\u753B\u9762: \u70BA\u66FF\u306F\u7279\u306B\u52D5\u304B\u306A\u3044\u3001\u6761\u4EF6\u306A\u3057", () => {
  const r = diagnose(base({}, { q28: null, q29: null }));
  assert.equal(r.rows[6].rule, "\u7279\u306B\u52D5\u304B\u306A\u3044");
  assert.equal(r.rows[4].rule, "\u307E\u3060\u6C7A\u3081\u3066\u3044\u307E\u305B\u3093");
});
test("formatYen", () => {
  assert.equal(formatYen(9999), "9,999\u5186");
  assert.equal(formatYen(75e4), "75\u4E07\u5186");
  assert.equal(formatYen(1234567), "123\u4E074,567\u5186");
});
test("\u7981\u6B62\u8A9E\u304C\u6587\u8A00\u306B\u5165\u3063\u3066\u3044\u306A\u3044", () => {
  const banned = ["\u5FC5\u305A", "\u78BA\u5B9F\u306B", "\u3059\u3079\u304D", "\u8CB7\u3044\u6642", "\u58F2\u308A\u6642", "\u304A\u3059\u3059\u3081", "\u623B\u308A\u307E\u3059"];
  const i = base({ tolerancePct: 10 }, {
    q03: "none",
    q06: "has",
    q09: "y3to5",
    q10: "often",
    q12: "yes",
    q14: "often",
    q15: "buy_more",
    q16: "fast",
    q19: "often",
    q18: "many_daily",
    q20: "stock",
    q21: ["tech_semis"],
    q23: "gt50"
  });
  const r = diagnose({ ...i, perStockCapPct: 50, financialAssets: 3e6 });
  const text = [r.typeDetail, ...r.advice.map((a) => a.text), ...r.rows.map((x) => x.meaning)].join("\n");
  for (const w of banned) assert.ok(!text.includes(w), w);
});
