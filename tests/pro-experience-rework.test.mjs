// PRO feature tour, owner's iPhone review (Nov 16): the 22-stock sample shows the earnings deep dive, the radar sample shows the 体力ランキング,
// the comparison picker numbers its choices, and the PRO tag sits level with the page title.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as radarLib from "../lib/research/radar.ts";
import * as radarPeriod from "../lib/research/radar-period.ts";
import { SAMPLE_HINTS } from "../lib/research/pro-experience-samples.ts";
import { OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID } from "../lib/membership/entitlements.ts";

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, stubs = {}) {
  const out = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", out)(id => id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : id in stubs ? stubs[id] : require(id), mod, mod.exports);
  return mod.exports;
}
const text = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const MISSING = /—|未取得|未開示|確認中|準備中|確認できません|データなし|N\/A|undefined|NaN|null|Infinity/;
const SAMPLES = "../app/research/pro-experience/samples/";

const EarningsDive = load("../app/research/companies/earnings-dive.tsx", {
  "next/link": { default: ({ children, ...props }) => createElement("a", props, children) },
  "../pro-experience/pro-tag": { default: () => createElement("span", null, "PRO") },
}).default;
const dives = JSON.parse(read("../lib/research/pro-experience-samples/watch22-dives.json")).dives;

test("22 tracked stocks: NVDA's (and AMD's) earnings deep dive renders in full from saved made-up data, with nothing blank", () => {
  assert.deepEqual(dives.map(d => d.ticker), ["NVDA", "AMD"]);
  for (const dive of dives) for (const lang of ["ja", "en"]) {
    const html = renderToStaticMarkup(createElement(EarningsDive, { lang, name: dive.name, ticker: dive.ticker, live: dive.live, unlocked: true, history: dive.history, failed: false }));
    const t = text(html), at = `${dive.ticker} ${lang}`;
    assert.doesNotMatch(t, MISSING, at);
    assert.doesNotMatch(html, /href=/, `${at}: nothing to follow out of the sample`);
    if (lang === "ja") {
      for (const part of ["決算の深掘り", "数字 反映済み", "まとめ 反映済み", "結論", "売上高", "調整後EPS", "次期の見通し", "EPS 予想との差",
        "01 成長の中身", "02 前回からの変化", "03 注意点", "04 次に見るポイント", "売上高の推移", "次期の売上見通し"]) assert.ok(t.includes(part), `${at}: ${part}`);
      assert.equal((html.match(/<summary[^>]*>詳しい解説/g) ?? []).length, 4, at);
    }
    assert.equal((html.match(/<figure/g) ?? []).length, 2, `${at}: the revenue trend and the outlook range`);
  }
  // The dives sit on the sample's made-up timeline.
  for (const dive of dives) {
    assert.ok(Date.parse(dive.live.dive.summaryAt) <= Date.parse("2035-03-12T00:00:00Z"));
    assert.match(dive.live.period, /^FQ[1-4] 203\d$/);
    assert.ok(dive.history.length >= 3);
  }
  const ui = read(`${SAMPLES}watch-22.tsx`);
  assert.match(ui, /<EarningsDive [^>]*live=\{dive\.live\} unlocked history=\{dive\.history\} failed=\{false\} \/>/);
  assert.match(ui, /useState<string>\(dives\[0\]\.ticker\)/, "the sample opens on NVDA's deep dive");
  assert.match(SAMPLE_HINTS["watch-22"].ja, /決算の深掘り/);
  // The ticker chips outrank the shell's `.app button{font:inherit}` (the 16px body font made GOOGL overflow at 360px).
  const chip = read(`${SAMPLES}samples.module.css`).match(/\.tickers \.ticker\{([^}]*)\}/)[1];
  assert.match(chip, /min-width:0/);
  assert.match(chip, /overflow:hidden/);
  assert.match(chip, /font-family:var\(--font-geist-mono,ui-monospace\)/);
  assert.match(chip, /font-size:11px/);
  assert.doesNotMatch(chip, /(^|;)font:/);
});

test("Financial Radar: the 体力ランキング shows six ranked companies of one genre (semiconductors), every figure filled", () => {
  const radar = JSON.parse(read("../lib/research/pro-experience-samples/radar.json")).radar;
  assert.equal(radar.tier, "pro");
  assert.equal(radar.genre, "semis");
  const genre = radarLib.radarGenre("semis");
  assert.deepEqual(radar.dots.map(dot => dot.ticker), [...genre.tickers]);
  assert.deepEqual(radar.missing, []);
  assert.deepEqual(radar.dots.map(dot => dot.rank).sort(), [1, 2, 3, 4, 5, 6]);
  for (const dot of radar.dots) {
    for (const key of ["ocfMargin", "cover", "fcfMargin", "growth", "score", "rank", "size"]) assert.ok(Number.isFinite(dot[key]), `${dot.ticker} ${key}`);
    assert.equal(dot.review, false);
    assert.ok(dot.previous && Number.isFinite(dot.previous.ocfMargin) && Number.isFinite(dot.previous.cover), `${dot.ticker} previous`);
  }
  // Rendered by the real ranking of the radar page.
  const chart = load("../app/research/radar/chart.tsx", { "@/lib/research/radar": radarLib });
  const screen = load("../app/research/radar/screen.tsx", {
    "@/lib/research/radar": radarLib, "@/lib/research/radar-period": radarPeriod, "./chart": chart, "./genre-picker": { default: () => null },
    "../research-tool-shell": { default: ({ children }) => children }, "../use-research-language": { useResearchLanguage: () => ["ja", () => {}] },
  });
  const html = renderToStaticMarkup(createElement(screen.StrengthRanking, { pro: radar, lang: "ja" }));
  const t = text(html);
  assert.match(t, /体力ランキング 最新の決算（10〜12月期）/);
  assert.equal((html.match(/<article/g) ?? []).length, 6);
  assert.doesNotMatch(t, MISSING);
  assert.match(t, /データが足りない銘柄 ・ 0件/);
  const order = [...t.matchAll(/\b(NVDA|AMD|INTC|QCOM|AMAT|LRCX)\b/g)].map(m => m[1]);
  assert.deepEqual(order, [...radar.dots].sort((a, b) => a.rank - b.rank).map(dot => dot.ticker));
  const ui = read(`${SAMPLES}financial-radar.tsx`);
  assert.match(ui, /<StrengthRanking pro=\{radar\} lang=\{lang\} \/>/);
  assert.ok(ui.indexOf("<StrengthRanking") < ui.indexOf("<RadarChart"), "the ranking comes first");
  assert.match(read("../app/research/radar/screen.tsx"), /\{pro \? <StrengthRanking pro=\{pro\} lang=\{lang\} \/> : !confirmed \?/);
  assert.match(SAMPLE_HINTS["financial-radar"].ja, /順位/);
});

test("Stock Comparison: the chosen stocks carry ① and ② in the order chosen, and the replacement rule is written under them", () => {
  const ui = read(`${SAMPLES}compare.tsx`);
  assert.match(ui, /const order = picked\.indexOf\(ticker\);/);
  assert.match(ui, /<span className=\{styles\.pickNo\} data-slot=\{order\} aria-hidden="true">\{order \+ 1\}<\/span>/);
  assert.match(ui, /3つ目を選ぶと、①が外れて入れ替わります/);
  assert.match(ui, /current\.length >= 2 \? \[current\[1\], ticker\]/, "a third choice drops ①");
  assert.match(ui, /compareSample\(picked\)/, "① is the first (gold) company of the result");
  const css = read(`${SAMPLES}samples.module.css`);
  assert.match(css, /\.pickNo\{[^}]*background:#ffc247/);
  assert.match(css, /\.pickNo\[data-slot="1"\]\{background:#4cc9f0\}/);
});

test("the PRO tag sits level with the page title: the shell's `.main h1` margin no longer pushes the heading down", () => {
  const css = read("../app/research/pro-experience/styles.module.css");
  assert.match(read("../app/research/research-tools.module.css"), /\.main h1 \{[^}]*margin: 22px 0 10px/);
  assert.match(css, /\.titleRow\{display:flex;align-items:center/);
  assert.match(css, /\.titleRow \.title\{margin:0;font-size:24px;line-height:1\.3\}/);
});

test("operator access: the owner's accounts still never see 「PROではじめる」 on the reworked samples", async () => {
  const { showStartButton } = await import("../lib/research/pro-experience-samples.ts");
  assert.ok(OWNER_ACCOUNT_ID && PRODUCTION_OWNER_ACCOUNT_ID);
  assert.equal(showStartButton({ settled: true, plan: "free", ownerAccount: true, ownerRole: false }), false);
});
