import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { parseDive, watchEarningsPayload } from "../lib/research/watch-earnings.ts";

const require = createRequire(import.meta.url);
function load(path, stubs = {}) {
  const out = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", out)(id => id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : id in stubs ? stubs[id] : require(id), mod, mod.exports);
  return mod.exports;
}
const EarningsDive = load("../app/research/companies/earnings-dive.tsx", {
  "next/link": { default: ({ children, ...props }) => createElement("a", props, children) },
  "../pro-experience/pro-tag": { default: () => createElement("span", null, "PRO") },
}).default;

const c = (ja, en) => ({ ja, en });
const numbers = { revenue: { current: 54229, previous: 41456, yearAgo: null }, adjustedEPS: 12.5, epsEstimate: null, grossMargin: { current: 87, previous: 84.9 },
  guidance: { low: 60000, high: 63000, grossMarginPercent: 86.25 },
  segments: [{ key: "core", nameJa: "コア・データセンター", nameEn: "Core Data Center", revenue: 18002, previous: 11524, operatingMargin: 85, previousOperatingMargin: 83 }] };
const card = (headline, chips, sections, segment) => ({ headline, chips, sections, segment });
const summary = { conclusion: [c("売上は前期から約3割増え、コア・データセンター部門が伸びを引っ張りました。", "Revenue rose about 30% from the previous quarter, led by the Core Data Center segment.")],
  cards: {
    growth: card(c("コア・データセンター部門が最大の伸び", "Core Data Center led the growth"), [{ tone: "up", text: c("部門売上 +56.2%", "Segment revenue +56.2%") }], [{ key: "happened", text: c("何かが起きた", "Something happened") }], "core"),
    change: card(c("売上は前期比 +30.8%", "Revenue up 30.8% QoQ"), [], [{ key: "happened", text: c("売上は増えました", "Revenue rose") }]),
    next: card(c("次期の会社見通しを追う", "Follow the outlook"), [{ tone: "gold", text: c("売上 600〜630億ドル", "Revenue $60.0–63.0B") }], [{ key: "view", text: c("次の決算で見ます", "Next report") }]),
  } };
const live = (dive) => ({ period: "FQ4 2026", releasedOn: "2026-09-30", ticker: "MU", publicAt: "2026-09-30T13:43:00Z", dive });
const render = (props) => renderToStaticMarkup(createElement(EarningsDive, { lang: "ja", name: "Micron", ticker: "MU", unlocked: true, history: [], failed: false, ...props }));
const text = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("the full dive: title, subtitle, both status marks with their times, takeaway, numbers and only the cards that were built", () => {
  const html = render({ live: live({ numbers, summary, summaryAt: "2026-09-30T13:58:00Z", failed: false }) });
  const t = text(html);
  assert.match(t, /決算の深掘り PRO/);
  assert.match(t, /Micron \(MU\) FQ4 2026 9\/30発表/);
  assert.match(t, /数字 反映済み 22:43/);          // 13:43Z is 22:43 JST
  assert.match(t, /まとめ 反映済み 22:58/);
  assert.match(t, /結論 売上は前期から約3割増え/);
  assert.match(t, /売上高 542\.29 億ドル 前期比 \+30\.8%/);
  assert.match(t, /調整後EPS 12\.50 ドル/);
  assert.match(t, /次期の見通し 600〜630 億ドル\(売上\)/);
  assert.match(t, /01 成長の中身/); assert.match(t, /02 前回からの変化/); assert.match(t, /04 次に見るポイント/);
  assert.doesNotMatch(t, /03 注意点/);             // no figure for card 03: no card, not an empty one
  assert.doesNotMatch(t, /EPS 予想との差|EPSとは/);  // no estimate was read: no EPS card
  assert.doesNotMatch(t, /表示例|過去分は/);         // the sample tags are not shown in production
  assert.doesNotMatch(html, /<details[^>]* open/);    // 詳しい解説 starts closed
  assert.equal((html.match(/<summary[^>]*>詳しい解説/g) ?? []).length, 3);
  assert.doesNotMatch(t, /…/);
});

test("the EPS card appears only when an estimate was read, with its 'what is EPS' note", () => {
  const html = render({ live: live({ numbers: { ...numbers, epsEstimate: 11.8 }, summary, summaryAt: "2026-09-30T13:58:00Z", failed: false }) });
  const t = text(html);
  assert.match(t, /EPS 予想との差 調整後EPSは、予想を上回りました/);
  assert.match(t, /予想\(アナリスト平均\) 11\.80ドル/);
  assert.match(t, /\+5\.9% 上回る/);
  assert.match(t, /調整後EPS 12\.50 ドル 予想比 \+5\.9%/);
  assert.match(t, /EPSとは/);
  assert.doesNotMatch(html, /<details[^>]* open/);
});

test("English view: same structure, English wording", () => {
  const t = text(render({ lang: "en", live: live({ numbers, summary, summaryAt: "2026-09-30T13:58:00Z", failed: false }) }));
  assert.match(t, /Earnings Deep Dive PRO/);
  assert.match(t, /Micron \(MU\) FQ4 2026 Reported Sep 30/);
  assert.match(t, /Numbers updated 22:43/); assert.match(t, /Summary ready 22:58/);
  assert.match(t, /Takeaway/); assert.match(t, /01 WHAT DROVE GROWTH/); assert.match(t, /Details/);
  assert.match(t, /Next quarter \$60–63B Company outlook/);
  assert.doesNotMatch(t, /[ぁ-んァ-ン一-龥]/);
});

test("numbers first: until the summary exists the second mark says 準備中 and only the numbers are shown", () => {
  const html = render({ live: live({ numbers, summary: null, summaryAt: null, failed: false }) });
  const t = text(html);
  assert.match(t, /数字 反映済み 22:43/);
  assert.match(t, /まとめ 準備中/);
  assert.doesNotMatch(t, /まとめ 反映済み|結論|01 成長の中身/);
  assert.match(t, /売上高 542\.29/);
});

test("when the figures could not be read the screen says 確認中 and keeps its layout; a free viewer sees the sign-in link", () => {
  const checking = text(render({ live: null }));
  assert.match(checking, /数字 確認中/); assert.match(checking, /まとめ 確認中/); assert.match(checking, /決算の数字を確認しています/);
  const locked = text(render({ live: live({ numbers, summary, summaryAt: null, failed: false }), unlocked: false }));
  assert.match(locked, /ログイン・プランを確認/);
  assert.doesNotMatch(locked, /542\.29/);
  const failed = text(render({ live: live({ numbers, summary: null, summaryAt: null, failed: true }) }));
  assert.match(failed, /まとめ 確認中/);
});

test("the revenue chart is drawn only with at least three earlier quarters from the SEC", () => {
  const dive = live({ numbers, summary, summaryAt: "2026-09-30T13:58:00Z", failed: false });
  assert.doesNotMatch(render({ live: dive, history: [{ label: "Q3", end: "2026-05-28", value: 41456 }] }), /売上高の推移/);
  const history = [["Q1", 13643], ["Q2", 23860], ["Q3", 41456]].map(([label, value], i) => ({ label, end: `2025-0${i + 1}-01`, value }));
  const html = render({ live: dive, history });
  assert.match(text(html), /売上高の推移\(億ドル\)/);
  assert.match(html, /aria-label="Q1 136\.43, Q2 238\.6, Q3 414\.56, Q4 542\.29"/);
});

test("the paid dive is parsed, a damaged one is dropped without breaking the page, and a free viewer never receives it", () => {
  const dive = { numbers, summary, summaryAt: "2026-09-30T13:58:00Z", summaryReason: null };
  assert.equal(parseDive(dive).summary.cards.growth.chips[0].tone, "up");
  assert.equal(parseDive({ ...dive, summary: { conclusion: [], cards: {} } }), null);
  assert.equal(parseDive({ numbers: { revenue: { current: "x" } } }), null);
  assert.equal(parseDive(null), null);
  assert.equal(parseDive({ numbers, summary: null, summaryAt: null, summaryReason: "dive-revenue-baseline-zero" }).failed, true);
  const snapshot = { revision: "a".repeat(64), ticker: "MU", period: "FQ4 2026", periodOrder: 8108, releasedOn: "2026-09-30", sourceUrl: "https://investors.micron.com/results",
    publishedAt: null, detectedAt: "2026-09-30T13:00:00Z", bodyReadyAt: "2026-09-30T13:00:12Z", preparedAt: "2026-09-30T13:00:13Z", publicAt: "2026-09-30T13:00:14Z",
    processingMs: 5, sourceToDetectionMs: null, detectionToPublicMs: 14000, method: "deterministic-issuer-numbers",
    tiles: [0, 1, 2].map(i => ({ label: c("a", "a"), value: c("b", "b"), note: c("c", "c") })),
    cards: [0, 1, 2, 3].map(() => ({ title: c("t", "t"), headline: c("h", "h"), points: [c("p", "p")], detail: c("d", "d"), sourceSection: "s" })), dive };
  const raw = { ok: true, status: "ready", snapshot };
  assert.equal(watchEarningsPayload(raw, { status: "signed-in", plan: "free" }, 100).snapshot.dive, null);
  assert.ok(!JSON.stringify(watchEarningsPayload(raw, { status: "signed-in", plan: "free" }, 100)).includes("コア・データセンター"));
  assert.equal(watchEarningsPayload(raw, { status: "signed-in", plan: "pro", accessExpiresAt: 200 }, 100).snapshot.dive.numbers.revenue.current, 54229);
  const broken = { ...raw, snapshot: { ...snapshot, dive: { numbers: { revenue: {} }, summary: null } } };
  const paid = watchEarningsPayload(broken, { status: "signed-in", plan: "pro", accessExpiresAt: 200 }, 100);
  assert.equal(paid.snapshot.dive, null);
  assert.equal(paid.snapshot.tiles.length, 3);   // the rest of the page still works
});
