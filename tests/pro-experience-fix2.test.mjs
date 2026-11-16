// PRO feature tour, owner's second iPhone review (Nov 16): the 22-stock sample shows only NVDA and AMD as buttons with the other 20 in a plain
// list, the feature pages' back link reads 「‹ PRO機能体験に戻る」 and takes one tap only, the list page has no 「‹ メニュー」, 「PROではじめる」
// is gold, and the comparison picker takes a third stock (① drops out) on a finger's tap as well as on a click.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { JSDOM } from "jsdom";
import ts from "typescript";
import * as sampleData from "../lib/research/pro-experience-sample-data.ts";
import * as scorecard from "../lib/research/comparison-scorecard.ts";
import * as samplesLib from "../lib/research/pro-experience-samples.ts";
import * as tourLib from "../lib/research/pro-experience.ts";
const { showStartButton } = samplesLib;
import { OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID } from "../lib/membership/entitlements.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://techphase.app/research/pro-experience/compare" });
for (const key of ["window", "document", "navigator", "Node", "HTMLElement", "Element", "Event", "MouseEvent"]) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, stubs = {}) {
  const out = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", out)(id => id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : id in stubs ? stubs[id] : require(id), mod, mod.exports);
  return mod.exports;
}
const SAMPLES = "../app/research/pro-experience/samples/";
const h = React.createElement;

async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return { container, done: async () => { await act(async () => root.unmount()); container.remove(); } };
}
function pointer(target, type, { id = 1, kind = "touch", x = 10, y = 10 } = {}) {
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: id });
  Object.defineProperty(event, "pointerType", { value: kind });
  target.dispatchEvent(event);
}

// ---- 4. Stock Comparison ----
const Visual = name => ({ companies }) => h("div", { "data-visual": name }, companies.map(c => c.ticker).join("-"));
const CompareSample = load(`${SAMPLES}compare.tsx`, {
  "@/lib/research/comparison-scorecard": scorecard,
  "@/lib/research/pro-experience-sample-data": sampleData,
  "../../compare/comparison-visuals": { CompanyScoreCard: ({ company }) => h("div", null, company.ticker), ScoreHeadline: Visual("headline"), VerdictHeading: Visual("verdict"), ScoreOverview: Visual("overview"), StatusOverlay: Visual("overlay") },
  "../../compare/detail-panels": { default: ({ children }) => h("div", null, children) },
}).default;
const chips = container => [...container.querySelectorAll('[role="group"] button')];
const chip = (container, ticker) => chips(container).find(button => button.textContent.endsWith(ticker));
const picked = container => chips(container).filter(button => button.getAttribute("aria-pressed") === "true")
  .map(button => [button.querySelector("[data-slot]").textContent, button.textContent.replace(/^\d/, "")]).sort().map(([, t]) => t);
const verdict = container => container.querySelector('[data-visual="verdict"]')?.textContent ?? null;

test("nextPicks: a chosen stock comes out, a third drops ① (② becomes ①, the tapped one ②), and no tap is ever refused", () => {
  const { nextPicks } = sampleData;
  assert.deepEqual(nextPicks(["NVDA", "AMD"], "INTC"), ["AMD", "INTC"]);
  assert.deepEqual(nextPicks(["AMD", "INTC"], "ARM"), ["INTC", "ARM"]);
  assert.deepEqual(nextPicks(["NVDA", "AMD"], "NVDA"), ["AMD"]);
  assert.deepEqual(nextPicks(["NVDA", "AMD"], "AMD"), ["NVDA"]);
  assert.deepEqual(nextPicks(["AMD"], "ARM"), ["AMD", "ARM"]);
  assert.deepEqual(nextPicks([], "INTC"), ["INTC"]);
  for (const [a, b] of sampleData.comparePairs()) for (const t of sampleData.COMPARE_TICKERS) assert.ok(nextPicks([a, b], t).length >= 1, `${a}-${b} + ${t}`);
});

for (const kind of ["click", "touch"]) test(`Stock Comparison (${kind}): after NVDA and AMD, INTC and ARM can be chosen; no chip is ever disabled; every pair shows its result`, async () => {
  const { container, done } = await mount(h(CompareSample, { lang: "ja" }));
  try {
    const tap = async ticker => {
      const button = chip(container, ticker);
      await act(async () => {
        if (kind === "click") { button.click(); return; }
        // A finger: pointerdown/up on the chip answers at once; the click iPhone Safari may or may not send afterwards changes nothing more.
        pointer(button, "pointerdown"); pointer(button, "pointerup"); button.click();
      });
    };
    const noneDisabled = () => chips(container).every(button => !button.disabled && !button.hasAttribute("disabled") && button.getAttribute("aria-disabled") !== "true");
    assert.deepEqual(picked(container), ["NVDA", "AMD"]);
    assert.equal(verdict(container), "NVDA-AMD");
    assert.ok(noneDisabled(), "two chosen: the other chips stay enabled");
    await tap("INTC");
    assert.deepEqual(picked(container), ["AMD", "INTC"], "① NVDA dropped, AMD became ①, INTC ②");
    assert.equal(chip(container, "AMD").querySelector("[data-slot]").textContent, "1");
    assert.equal(chip(container, "INTC").querySelector("[data-slot]").textContent, "2");
    assert.equal(verdict(container), "AMD-INTC");
    assert.ok(noneDisabled());
    await tap("ARM");
    assert.deepEqual(picked(container), ["INTC", "ARM"]);
    assert.equal(verdict(container), "INTC-ARM");
    await tap("ARM");
    assert.deepEqual(picked(container), ["INTC"], "tapping a chosen stock takes it out");
    assert.equal(verdict(container), null);
    assert.match(container.textContent, /もう1つ選ぶと、結果が開きます。/);
    // All six pairs, reached by taps from wherever the picker is.
    const seen = new Set();
    for (const [a, b] of sampleData.comparePairs()) {
      for (const button of chips(container).filter(button => button.getAttribute("aria-pressed") === "true")) await tap(button.textContent.replace(/^\d/, ""));
      assert.deepEqual(picked(container), []);
      await tap(a); await tap(b);
      assert.deepEqual(picked(container), [a, b]);
      assert.equal(verdict(container), `${a}-${b}`, `${a}-${b} shows its result at once`);
      assert.ok(noneDisabled());
      seen.add(`${a}-${b}`);
    }
    assert.equal(seen.size, 6);
  } finally { await done(); }
});

test("Stock Comparison: a finger that moves (a scroll) chooses nothing; a touch answered on pointerup is not undone by its click", async () => {
  const { container, done } = await mount(h(CompareSample, { lang: "ja" }));
  try {
    const intc = chip(container, "INTC");
    await act(async () => { pointer(intc, "pointerdown", { y: 10 }); pointer(intc, "pointerup", { y: 40 }); });
    assert.deepEqual(picked(container), ["NVDA", "AMD"], "moved 30px: a scroll");
    await act(async () => { pointer(intc, "pointerdown"); pointer(intc, "pointercancel"); });
    assert.deepEqual(picked(container), ["NVDA", "AMD"], "cancelled");
    await act(async () => { pointer(intc, "pointerdown"); pointer(intc, "pointerup"); });
    assert.deepEqual(picked(container), ["AMD", "INTC"], "pointerup alone is enough (iPhone may send no click)");
    await act(async () => { intc.click(); });
    assert.deepEqual(picked(container), ["AMD", "INTC"], "the click after that tap is ignored");
    await act(async () => { chip(container, "ARM").click(); });
    assert.deepEqual(picked(container), ["INTC", "ARM"], "a mouse or keyboard click still works");
  } finally { await done(); }
});

test("Stock Comparison: 「PROならすべての銘柄で比較できます」 sits right under the replacement rule, 12.5px mint; the chips have no disabled path", () => {
  const ui = read(`${SAMPLES}compare.tsx`);
  const rule = ui.indexOf("3つ目を選ぶと、①が外れて入れ替わります"), pro = ui.indexOf("PROならすべての銘柄で比較できます");
  assert.ok(rule > 0 && pro > rule && pro < ui.indexOf("もう1つ選ぶと"), "under the rule, above the result");
  assert.match(ui, /<p className=\{styles\.pickPro\}>/);
  assert.doesNotMatch(ui, /disabled/);
  const css = read(`${SAMPLES}samples.module.css`);
  assert.match(css, /\.pickPro\{[^}]*font-size:12\.5px[^}]*color:#8fe3c0/);
  assert.match(css, /\.pills \.pill\{touch-action:manipulation/);
  assert.doesNotMatch(css, /\.pill[^{]*\{[^}]*pointer-events:none/);
});

// ---- 1. 22 tracked stocks ----
const Watch22 = load(`${SAMPLES}watch-22.tsx`, {
  "@/lib/research/pro-experience-samples/watch22-dives.json": { default: JSON.parse(read("../lib/research/pro-experience-samples/watch22-dives.json")) },
  "@/lib/research/pro-experience-samples/watch22.json": { default: JSON.parse(read("../lib/research/pro-experience-samples/watch22.json")) },
  "../../companies/earnings-dive": { default: ({ ticker }) => h("section", { "data-dive": ticker }, `決算の深掘り ${ticker}`) },
}).default;
test("22 tracked stocks: only NVDA and AMD are buttons; 「一覧 ▾」 opens the other 20 as plain text, 「閉じる ▴」 closes it", async () => {
  const { container, done } = await mount(h(Watch22, { lang: "ja" }));
  try {
    const buttons = () => [...container.querySelectorAll("button")];
    assert.deepEqual(buttons().map(b => b.textContent), ["NVDA", "AMD", "一覧 ▾"]);
    const [nvda, amd, toggle] = buttons();
    assert.equal(nvda.getAttribute("aria-pressed"), "true");
    assert.equal(container.querySelector("[data-dive]").dataset.dive, "NVDA");
    await act(async () => amd.click());
    assert.equal(amd.getAttribute("aria-pressed"), "true");
    assert.equal(nvda.getAttribute("aria-pressed"), "false");
    assert.equal(container.querySelector("[data-dive]").dataset.dive, "AMD");
    assert.match(container.textContent, /PROなら22銘柄すべて見られます/);
    assert.equal(container.querySelector("ul"), null, "closed at first");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    await act(async () => toggle.click());
    const list = container.querySelector("ul");
    const tickers = [...list.querySelectorAll("li")].map(li => li.textContent);
    assert.deepEqual(tickers, ["MU", "SKHY", "SNDK", "NBIS", "AVGO", "ARM", "TSM", "ASML", "MRVL", "ANET", "CRDO", "CRWV", "VRT", "GEV", "PLTR", "MSFT", "BE", "GOOGL", "LITE", "ALAB"]);
    assert.equal(list.querySelectorAll("button, a, [role=button], [tabindex]").length, 0, "the 20 cannot be tapped");
    assert.equal(toggle.textContent, "閉じる ▴");
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(toggle.getAttribute("aria-controls"), list.id);
    await act(async () => toggle.click());
    assert.equal(container.querySelector("ul"), null);
    assert.equal(toggle.textContent, "一覧 ▾");
  } finally { await done(); }
  const css = read(`${SAMPLES}samples.module.css`);
  assert.match(css, /\.diveChoice\{display:flex;gap:8px\}/);
  assert.match(css, /\.diveChoice \.diveChip\{flex:1 1 0;[^}]*height:44px/);
  assert.match(css, /\.diveChoice \.diveChip\[aria-pressed="true"\]\{border:1\.5px solid #8fe3c0;background:#12261d;color:#8fe3c0\}/);
  assert.match(css, /\.otherList li\{[^}]*font-size:12px;[^}]*color:#7d8a9a/);
  assert.match(css, /\.otherList li\{font-family:var\(--font-geist-mono/);
});

// ---- 2. Back link, list page ----
let pushed = [];
const LinkStub = { default: ({ href, prefetch, children, ...props }) => h("a", { href, "data-prefetch": String(prefetch), ...props, onClick: event => { props.onClick?.(event); if (!event.defaultPrevented) { event.preventDefault(); pushed.push(href); } } }, children) };
const Screen = load("../app/research/pro-experience/screen.tsx", {
  "next/link": LinkStub, "@/lib/research/pro-experience": tourLib, "@/lib/research/pro-experience-samples": samplesLib,
  "../research-tool-shell": { default: ({ children }) => h("main", null, children) },
  "../use-research-language": { useResearchLanguage: () => ["ja", () => {}] },
  "../member-display-provider": { useMemberDisplay: () => "free", useMemberSettled: () => true, useOwnerAccount: () => false, useResearchOwner: () => false },
  "./samples": { default: () => h("div", { "data-sample": true }) },
  "./feature-icons": { default: () => null },
  "./pro-tag": { default: () => h("span", null, "PRO") },
});

test("back link: 「‹ PRO機能体験に戻る」 to the prefetched list; a second tap before the list opens is refused; vibrate only where it exists", async () => {
  pushed = [];
  const buzz = [];
  Object.defineProperty(dom.window.navigator, "vibrate", { configurable: true, value: ms => { buzz.push(ms); return true; } });
  const { container, done } = await mount(h(Screen.BackToList, { ja: true }));
  try {
    const link = container.querySelector("a");
    assert.equal(link.textContent.trim(), "‹ PRO機能体験に戻る");
    assert.equal(link.getAttribute("href"), "/research/pro-experience");
    assert.equal(link.dataset.prefetch, "true");
    await act(async () => pointer(link, "pointerdown"));
    assert.equal(link.dataset.pressed, "true", "mint while pressed");
    await act(async () => pointer(link, "pointerup"));
    assert.equal(link.dataset.pressed, undefined);
    let second;
    await act(async () => { link.click(); });
    assert.equal(link.getAttribute("aria-disabled"), "true");
    await act(async () => { second = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }); link.dispatchEvent(second); });
    await act(async () => { link.click(); });
    assert.deepEqual(pushed, ["/research/pro-experience"], "one navigation for three taps");
    assert.equal(second.defaultPrevented, true);
    assert.deepEqual(buzz, [10]);
    await act(async () => pointer(link, "pointerdown"));
    assert.equal(link.dataset.pressed, undefined, "no pressed colour while locked");
  } finally { await done(); delete dom.window.navigator.vibrate; }
  // Without navigator.vibrate (iPhone Safari) the tap still works.
  pushed = [];
  const again = await mount(h(Screen.BackToList, { ja: true }));
  try {
    assert.equal(typeof dom.window.navigator.vibrate, "undefined");
    await act(async () => { again.container.querySelector("a").click(); });
    assert.deepEqual(pushed, ["/research/pro-experience"]);
  } finally { await again.done(); }
  const screen = read("../app/research/pro-experience/screen.tsx");
  assert.match(screen, /if \(typeof navigator\.vibrate === "function"\) navigator\.vibrate\(10\);/);
  const css = read("../app/research/pro-experience/styles.module.css");
  const back = css.match(/\.back\{([^}]*)\}/)[1];
  assert.match(back, /color:#7d8a9a/);
  assert.match(back, /font-size:12\.5px/);
  assert.doesNotMatch(back, /background|border:/, "no button chrome");
  assert.match(css, /\.back::after\{content:"";position:absolute;inset:-8px\}/);
  assert.match(css, /\.back:active,\.back\[data-pressed\]\{color:#8fe3c0\}/);
});

test("every feature page uses the new back link; the list page has no 「‹ メニュー」 link", async () => {
  const screen = read("../app/research/pro-experience/screen.tsx");
  const detail = screen.slice(screen.indexOf("export function ProExperienceDetail"));
  assert.match(detail, /<BackToList ja=\{ja\} \/>/);
  assert.doesNotMatch(screen, /"‹ PRO機能体験"|PRO機能体験" : "PRO feature tour"\}<\/Link>/);
  const { container, done } = await mount(h(Screen.ProExperienceList));
  try {
    assert.doesNotMatch(container.textContent, /メニュー/);
    assert.equal(container.querySelector('a[href="/research"]'), null);
    assert.equal(container.querySelector("p").textContent, "PRO PREVIEW", "the heading comes first");
  } finally { await done(); }
  const page = await mount(h(Screen.ProExperienceDetail, { id: "compare" }));
  try {
    const first = page.container.querySelector("a");
    assert.equal(first.textContent.trim(), "‹ PRO機能体験に戻る");
    assert.equal(page.container.querySelector(`a[href="/research/account?upgrade=1"]`).textContent, "PROではじめる");
  } finally { await page.done(); }
});

// ---- 3. 「PROではじめる」 ----
test("「PROではじめる」 is gold and glowing (52px, radius 14px, 16px 800 #2a1d07); still hidden for PRO and the owner's accounts", () => {
  const css = read("../app/research/pro-experience/styles.module.css");
  const go = css.match(/\.go\{([^}]*)\}/)[1];
  assert.match(go, /height:52px/);
  assert.match(go, /border-radius:14px/);
  assert.match(go, /background:linear-gradient\(135deg,#f1dca0,#d9b25f 55%,#b8893a\)/);
  assert.match(go, /color:#2a1d07/);
  assert.match(go, /font:800 16px/);
  assert.match(go, /box-shadow:0 0 22px rgba\(226,194,122,\.45\),inset 0 1px 0 rgba\(255,255,255,\.5\)/);
  assert.match(read("../app/research/pro-experience/screen.tsx"), /PROなら好きな銘柄で使えます/);
  // Operator access (AGENTS.md): the owner's accounts count as PRO everywhere and never see the button.
  assert.ok(OWNER_ACCOUNT_ID && PRODUCTION_OWNER_ACCOUNT_ID);
  assert.equal(showStartButton({ settled: true, plan: "free", ownerAccount: true, ownerRole: false }), false);
  assert.equal(showStartButton({ settled: true, plan: "free", ownerAccount: false, ownerRole: true }), false);
  assert.equal(showStartButton({ settled: true, plan: "pro", ownerAccount: false, ownerRole: false }), false);
  assert.equal(showStartButton({ settled: true, plan: "free", ownerAccount: false, ownerRole: false }), true);
});
