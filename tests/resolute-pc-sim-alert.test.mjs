// RESOLUTE PC versions of ② Simulation and ③ Closing alert, and the wording changes for phone and PC (owner, Nov 25).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dropGauge, capBars, ruleFacts, toleranceVerdict, formatMoney } from "../lib/resolute/plan-rules.ts";
import { latestAlertView, todayTodo } from "../lib/resolute/latest-alert.ts";
import { createReviewSamplePlan } from "../lib/resolute/review-sample.ts";
import { simulateDrop } from "../lib/resolute/simulate.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const plan = createReviewSamplePlan(); // 300万円 invested, −30% tolerance (90万円), 10% cap, −10%/−20% × 30万円
const facts = ruleFacts(plan);

test("exactly at the loss limit has its own words, on the phone and on PC", () => {
  const p = { currency: "JPY", monthlyExpenses: 250000, tolerableLoss: 900000, singleStockCapPct: 10, buyLines: [] };
  assert.equal(toleranceVerdict(simulateDrop(p, 3000000, 30), 900000, "JPY"), "exact");
  assert.equal(toleranceVerdict(simulateDrop(p, 3000000, 20), 900000, "JPY"), "within");
  assert.equal(toleranceVerdict(simulateDrop(p, 3000000, 31), 900000, "JPY"), "over");
  assert.equal(toleranceVerdict({ lossAmount: 1234.56, withinTolerance: true }, 1234.56, "USD"), "exact");
  assert.equal(toleranceVerdict({ lossAmount: 1234.55, withinTolerance: true }, 1234.56, "USD"), "within");
  const screen = read("../app/resolute/simulation/screen.tsx");
  assert.match(screen, /ちょうど許容できる<\/span><span className=\{styles\.phrase\}>下落額です/);
  assert.match(screen, /これより下がったら、新しく買うのをやめてルールを読み直します/);
  // Within and over keep their words.
  assert.match(screen, /許容額まで、あと\$\{cash\(limit-loss\.lossAmount\)\}の余裕があります。/);
  assert.match(screen, /許容額を\$\{cash\(loss\.lossAmount-limit\)\}超えます。ルールを読み直す目安です。/);
});

test("the drop gauge stays inside the panel and grows past −50%", () => {
  const lines = [{ dropPct: 10, amount: 300000 }, { dropPct: 20, amount: 300000 }];
  const g = dropGauge(30, lines, 30);
  assert.equal(g.max, 50);
  assert.deepEqual(g.ticks, [0, 10, 20, 30, 40, 50]);
  assert.equal(g.fill, 0.6);
  for (const drop of [0, 30, 50, 51, 65, 80, 99, 100]) {
    const v = dropGauge(drop, [...lines, { dropPct: 60, amount: 1 }], 45);
    assert.ok(v.max >= Math.max(50, drop) && v.max <= 100, `max for ${drop}`);
    assert.equal(v.ticks[0], 0); assert.equal(v.ticks.at(-1), v.max);
    assert.ok(v.fill >= 0 && v.fill <= 1);
    for (const m of v.marks) { assert.ok(m.at >= 0 && m.at <= 1); assert.ok(m.labelAt >= 0 && m.labelAt <= 1); }
  }
  assert.equal(dropGauge(65, lines, 30).max, 70);
  assert.equal(dropGauge(100, lines, 30).max, 100);
  // Labels on the same line do not sit on top of each other, and the last one stays at the bottom edge or above.
  const crowded = dropGauge(50, [{ dropPct: 49, amount: 1 }, { dropPct: 50, amount: 1 }], 50);
  const at = crowded.marks.map(m => m.labelAt);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 0.099, at.join());
  assert.ok(at.every(v => v <= 1 && v >= 0));
  // A tolerance outside the scale has no line.
  assert.equal(dropGauge(30, lines, 400).marks.some(m => m.kind === "tolerance"), false);
});

test("the rise bars use the single-stock cap as an amount, as in the diagnosis result", () => {
  assert.equal(facts.capAmount, 300000);
  const { cap, bars } = capBars([{ name: "NVDA", valueAfter: 180000 }, { name: "MU", valueAfter: 225000 }, { name: "AAPL", valueAfter: 375000 }], 300000, 10);
  assert.equal(cap, 300000);
  assert.deepEqual(bars.map(b => b.over), [0, 0, 75000]);
  assert.ok(bars.every(b => b.width >= 0 && b.width <= 1));
  assert.equal(capBars([{ name: "A", valueAfter: 100 }], null, 10).cap, 10);
  assert.equal(formatMoney(75000, "JPY", false), "7万5,000円");
});

test("「今日のお知らせ」: no 「あなたの計画では…」 on the page, a lead sentence, each stock's own rule, and 「今日やること」", () => {
  const alert = { date: "2026-11-24", items: [
    { kind: "line_reached", symbol: "NVDA", close: 161.4, dropPct: 10.3, newLines: [10] },
    { kind: "surge_cap", symbol: "AMD", close: 241.2, risePct: 50.8 }] };
  const v = latestAlertView(alert, "ja", { rules: facts, references: { NVDA: 180, AMD: 160 } });
  assert.equal(v.lead, "11月24日（米国市場）の終値で、あなたのラインに届いた銘柄です。");
  assert.deepEqual(v.cards.map(c => c.rule), ["買い増し　10%下がったら30万円", "1銘柄の上限　30万円　持ち分の偏りを確かめる"]);
  assert.deepEqual(v.cards.map(c => [c.price, c.change, c.label]), [["$161.40", "基準 $180 から −10.3%", "−10% のライン"], ["$241.20", "基準 $160 から +50.8%", "上昇の目安"]]);
  assert.deepEqual(v.todo, { title: "決めていた買い増しの日", sentences: ["NVDAが決めておいた−10%のラインに届きました。", "ルールどおりなら30万円を買い足す段階です。", "AMDは上がりすぎていないか、1銘柄の上限と比べてください。"] });
  // A saved reference price that does not match the alert is not shown.
  assert.equal(latestAlertView(alert, "ja", { references: { NVDA: 999 } }).cards[0].change, "基準から −10.3%");
  assert.equal(todayTodo({ date: "2026-11-24", items: [alert.items[1]] }, null, "ja").title, "持ち分を確かめる日");
  const page = read("../app/resolute/alerts/latest/screen.tsx");
  assert.doesNotMatch(page, /v\.notes/);
  assert.doesNotMatch(page, /v\.check/);
  assert.match(page, /v\.lead/);
  assert.match(page, /card\.rule/);
  assert.match(page, /v\.todo\.title/);
  // PC: two cards per row from two stocks, 「一冊を開く」 and 「今夜のひと息」.
  assert.match(page, /v\.cards\.length > 1 \? pc\.noticesTwo/);
  assert.match(page, /v\.openBook/);
  assert.match(read("../app/resolute/pc.module.css"), /\.noticesTwo \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
});

test("PC layout: 1024px and wider, the menu on the left, the phone layout unchanged below", () => {
  assert.match(read("../app/resolute/use-desktop.ts"), /\(min-width: 1024px\)/);
  const shell = read("../app/resolute/tool-shell.tsx");
  assert.match(shell, /if\(pc && desktop\) return/);
  for (const file of ["simulation/screen.tsx", "alerts/latest/screen.tsx"]) assert.match(read(`../app/resolute/${file}`), /<ToolShell identityReady=\{identityReady\} pc>/);
  assert.match(read("../app/resolute/notifications-screen.tsx"), /pc=\{mode==="alerts"\}/);
  // Delivery is not running yet, so the sentence stays (owner, Nov 25, B).
  assert.match(read("../app/resolute/notifications-screen.tsx"), /通知の配信は準備中です。この画面の試算で通知は送信されません。/);
  // Never cut words with an ellipsis on PC.
  assert.doesNotMatch(read("../app/resolute/pc.module.css"), /text-overflow:\s*ellipsis/);
});
