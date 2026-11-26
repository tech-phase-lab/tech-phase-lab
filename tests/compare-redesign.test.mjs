import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const { transform, loadBindings } = require("next/dist/build/swc");
await loadBindings();
// The real components, compiled with plain class names so the markup can be read.
let source = read("../app/research/compare/comparison-visuals.tsx")
  .replace('import type { ComparisonResult } from "@/lib/research/comparison";', "").replace('"use client";', "")
  .replace('from "@/lib/research/comparison-scorecard";', `from ${JSON.stringify(new URL("../lib/research/comparison-scorecard.ts", import.meta.url).href)};`)
  .replace('import styles from "./styles.module.css";', 'const styles = new Proxy({}, { get: (_, key) => String(key) });')
  .replace(/ComparisonResult\["companies"\]\[number\]/g, "any").replace(/ComparisonResult\["companies"\]/g, "any[]");
const compiled = await transform(`import React from ${JSON.stringify(pathToFileURL(require.resolve("react")).href)};\n${source}`, { filename: "v.tsx", jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "classic" } }, target: "es2022" }, module: { type: "es6" } });
const visuals = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
const { buildComparisonSample } = await import("../lib/research/comparison-sample.ts");
const { overallComparison } = await import("../lib/research/comparison-scorecard.ts");
const sample = buildComparisonSample(), now = Date.parse(sample.generatedAt);
const text = html => html.replace(/<[^>]+>/g, "");

test("two companies: the big scores are shown, the higher one's frame is gold, and a sentence counts the factors won from the scores", () => {
  const html = renderToStaticMarkup(React.createElement(visuals.ScoreHeadline, { companies: sample.companies.slice(0, 2), lang: "ja", now }));
  assert.match(html, /<b>8\.3<\/b>/); assert.match(html, /<b>6\.0<\/b>/);
  assert.equal((html.match(/data-leader="true"/g) ?? []).length, 1);
  assert.match(html.split('data-leader="true"')[0].split("<article").at(-1), /^ class="scoreBox"/, "the first card is the leader");
  // The factor count moved up into the verdict (owner, Nov 15); nothing is written under the cards.
  assert.doesNotMatch(text(html), /項目で上回りました/);
  const verdict = lang => renderToStaticMarkup(React.createElement(visuals.VerdictHeading, { ...overallComparison(sample.companies.slice(0, 2), lang, now), companies: sample.companies.slice(0, 2), lang, now }));
  assert.equal(text(verdict("ja")), "総合評価DEMO-A が優位7項目中5項目で上回りました");
  assert.equal(text(verdict("en")), "OverallDEMO-A leadsAhead on 5 of 7 factors");
});

test("a factor with equal scores is not counted as won", () => {
  const [a, b] = sample.companies;
  // Same company twice with a different ticker: every factor ties, so nobody wins anything and there is no sentence or gold frame.
  const twin = { ...a, ticker: "TWIN", name: "Twin" };
  const html = renderToStaticMarkup(React.createElement(visuals.ScoreHeadline, { companies: [a, twin], lang: "ja", now }));
  assert.doesNotMatch(html, /data-leader="true"/);
  const tie = renderToStaticMarkup(React.createElement(visuals.VerdictHeading, { ...overallComparison([a, twin], "ja", now), companies: [a, twin], lang: "ja", now }));
  assert.equal(text(tie), "総合評価拮抗", "a close result: the same label and bar, no winner colour, no count");
  assert.match(tie, /data-verdict="short"/); assert.doesNotMatch(tie, /text-shadow/);
  // Against a company that ties on some factors, only the strictly higher ones count (5 of the 7, as the scores say).
  const wins = text(renderToStaticMarkup(React.createElement(visuals.VerdictHeading, { ...overallComparison([a, b], "ja", now), companies: [a, b], lang: "ja", now }))).match(/7項目中(\d)項目/)[1];
  assert.equal(wins, "5");
});

test("the status overlay draws every company in its own colour, and factors without a score are not drawn", () => {
  const html = renderToStaticMarkup(React.createElement(visuals.StatusOverlay, { companies: sample.companies, lang: "ja", now }));
  for (const color of ["#ffc247", "#4cc9f0", "#ff7ac6"]) assert.ok(html.includes(`fill="${color}"`), color);
  assert.equal((html.match(/<circle /g) ?? []).length, 21, "seven points for each of three companies");
  const missing = structuredClone(sample.companies.slice(0, 2));
  missing[0].twelveData.statistics = null; // no valuation score for the first company
  const partial = renderToStaticMarkup(React.createElement(visuals.StatusOverlay, { companies: missing, lang: "ja", now }));
  assert.ok((partial.match(/<circle /g) ?? []).length < 14, "unscored factors have no point");
  assert.match(partial, /未取得・評価保留は描画しません/);
});

test("the snapshot gives each company a bar of the same width track; only the higher score is coloured", () => {
  const html = renderToStaticMarkup(React.createElement(visuals.ScoreOverview, { companies: sample.companies.slice(0, 2), lang: "ja", now }));
  assert.equal((html.match(/class="scoreTrack"/g) ?? []).length, 14);
  assert.equal((html.match(/data-winner="true"/g) ?? []).length, 7, "one winner for each of the seven factors");
  assert.match(html, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(html, /0点ではありません/, "owner, Nov 27: the 「— 未取得…」 legend is removed");
});

test("each company card keeps its strengths, weaknesses and status; every item is exactly one line", () => {
  const html = renderToStaticMarkup(React.createElement(visuals.CompanyScoreCard, { company: sample.companies[0], lang: "ja", now, colorIndex: 0 }));
  assert.match(text(html), /Atlas Demo/); assert.match(text(html), /長所/); assert.match(text(html), /短所/);
  const css = read("../app/research/compare/styles.module.css");
  const mine = css.slice(css.indexOf("/* ===== 銘柄比較PRO: gold on navy"));
  // nx9: 12px; 11px when long. Owner, Nov 15 「ここは1行固定」: the last rule keeps each item (and the empty case) on one line, ending in "…" if needed.
  assert.match(mine, /\.traitBox li\[data-fit="small"\]\{font-size:11px\}/);
  const polish = css.slice(css.indexOf("/* ===== Owner, Nov 15: compare polish"));
  assert.match(polish, /\.traitBox li,\.results \.traitBox li,\.companyCards \.traitBox p\{white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
});

test("Nov 15: strengths and weaknesses use short one-line forms, and the empty case is 「該当なし」", () => {
  const empty = structuredClone(sample.companies[0]); empty.preparedAnalysis.items = [];
  for (const [lang, word] of [["ja", "該当なし"], ["en", "None"]]) {
    const html = renderToStaticMarkup(React.createElement(visuals.CompanyScoreCard, { company: empty, lang, now, colorIndex: 0 }));
    assert.equal((text(html).match(new RegExp(word, "g")) ?? []).length, 2, lang);
    assert.doesNotMatch(text(html), /取得済みの数値では該当なし|None identified/);
  }
  // Saved analyses with the old long form are shown short; new analyses are written short at the source.
  assert.equal(visuals.compactTrait("営業赤字（利益率 -3509.7%）"), "営業赤字 -3509.7%");
  assert.equal(visuals.compactTrait("Operating loss (-3509.7% margin)"), "Operating loss -3509.7%");
  const loss = structuredClone(sample.companies[0]);
  loss.preparedAnalysis.items = [{ id: "operating-margin", kind: "weakness", short: { ja: "営業赤字（利益率 -3509.7%）", en: "Operating loss (-3509.7% margin)" }, detail: { ja: "", en: "" } }];
  const html = renderToStaticMarkup(React.createElement(visuals.CompanyScoreCard, { company: loss, lang: "ja", now, colorIndex: 0 }));
  assert.match(html, /<li title="営業赤字 -3509.7%" data-fit="normal">営業赤字 -3509.7%<\/li>/);
  for (const file of ["../lib/research/comparison-analysis.ts", "../lib/research/comparison-scorecard.ts"]) assert.doesNotMatch(read(file), /営業赤字（利益率|Operating loss \(/, file);
  // Every bullet the generators can write fits the 184px column at 360px (12px type, 11px when long: at most about 13 full-width characters).
  const width = item => [...item].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.58), 0);
  for (const item of ["営業赤字 -3509.7%", "売上減少 -43.5%", "営業利益率 40.2→34.5%", "有利子負債が現金を上回る", "約3か月の株価 -12.3%", "平均株式数 +12.5%", "簡易FCF率 -120.4%", "メモリ価格下落で減益リスク", "営業黒字 1/4四半期"]) {
    assert.ok(width(item) * 11 <= 154, item);
  }
});

test("Nov 15: equal score heights and no factor-count line under the cards", () => {
  const css = read("../app/research/compare/styles.module.css");
  const polish = css.slice(css.indexOf("/* ===== Owner, Nov 15: compare polish"));
  assert.match(polish, /\.scoreBox\{display:flex;flex-direction:column\}/);
  assert.match(polish, /\.boxName\{min-height:calc\(2em \* 1\.25\)\}/);
  assert.match(polish, /\.boxScore\{margin-top:auto/);
  const companies = structuredClone(sample.companies.slice(0, 2));
  companies[0].name = "ELI LILLY & Co"; companies[1].name = "Arbutus Biopharma Corp with a very long registered company name";
  const html = renderToStaticMarkup(React.createElement(visuals.ScoreHeadline, { companies, lang: "ja", now }));
  assert.doesNotMatch(text(html), /全社にそろう|項目の平均です/);
  assert.doesNotMatch(read("../app/research/compare/comparison-visuals.tsx"), /全社にそろう/);
  // The yardstick is kept in the 「比較条件・注意点」 disclosure.
  assert.match(read("../app/research/compare/screen.tsx"), /<summary>\{t\("比較条件・注意点", "Comparison caveats"\)\}<\/summary><ul>\{!result\.trial && assessment\.note && <li>\{assessment\.note\}<\/li>\}/);
});

test("Nov 15: the ticker search box never overflows the card on phones", () => {
  const css = read("../app/research/compare/styles.module.css");
  const polish = css.slice(css.indexOf("/* ===== Owner, Nov 15: compare polish"));
  // The old 18px side margins on a 100%-wide input made it 36px wider than the card; the inset is now padding on the details element.
  assert.match(polish, /\.tickerHelp>details\{box-sizing:border-box;width:100%;max-width:100%;min-width:0;padding-inline:18px\}/);
  assert.match(polish, /\.tickerHelp>details>\*:not\(summary\)\{margin-left:0;margin-right:0;max-width:100%;min-width:0;box-sizing:border-box\}/);
  assert.match(polish, /\.tickerHelp \.tickerSearch input\{width:100%;max-width:100%;min-width:0;inline-size:100%;box-sizing:border-box\}/);
  assert.match(polish, /\.tickerHelp\{box-sizing:border-box;width:100%;max-width:100%;min-width:0\}/);
  // Nothing after the fix brings the side margins back.
  assert.doesNotMatch(polish.slice(polish.indexOf(".tickerHelp .tickerSearch input")), /\.tickerHelp>details>\*:not\(summary\)\{margin-left:18px/);
});

test("the palette is navy and gold: card gradient, edge, gold button, and 120px or more of room under the last button", () => {
  const css = read("../app/research/compare/styles.module.css");
  const mine = css.slice(css.indexOf("/* ===== 銘柄比較PRO: gold on navy"));
  assert.match(mine, /\.pickCard\{[^}]*border:1px solid #2a3652[^}]*linear-gradient\(160deg,#16233a,#0e1522\)/);
  assert.match(mine, /\.pickSubmit button\{[^}]*linear-gradient\(180deg,#e3c47e,#c79f4c\)[^}]*color:#2a1f08/);
  assert.match(mine, /\.screenWrap\{padding-bottom:(1[2-9]\d|[2-9]\d\d)px\}/);
  assert.match(mine, /#d9b56a/);
  assert.doesNotMatch(mine, /#[0-9a-f]{3,6}\b[^;{}]*brown/i);
  for (const color of ["#ffc247", "#4cc9f0", "#ff7ac6"]) assert.ok(read("../app/research/compare/comparison-visuals.tsx").includes(color), color);
});

test("the input screen: three headings, chosen companies as cards with a colour mark, ticker in bold, name, ×; ticker search is one closed line", () => {
  const screen = read("../app/research/compare/screen.tsx");
  for (const text of ["3社目（任意）", "会社名・銘柄コードで追加", "この銘柄を比較する", "社を選択"]) assert.ok(screen.includes(text), text);
  assert.match(screen, /styles\.pickChosen/);
  assert.match(screen, /\["#ffc247", "#4cc9f0", "#ff7ac6"\]\[i\]/);
  assert.match(screen, /styles\.pickRemove/);
  const search = read("../app/research/compare/ticker-search.tsx");
  assert.match(search, /<summary>\{t\("ティッカー検索", "Find a ticker"\)\}<\/summary>/);
  assert.doesNotMatch(search, /tickerHelpTitle/);
  assert.doesNotMatch(search, /<details[^>]*\bopen\b/);
});

test("the result is ordered: headline, scores, sentence, overlay, explanation, snapshot, then companies, then the two detail buttons", () => {
  const screen = read("../app/research/compare/screen.tsx");
  const order = ["<VerdictHeading", "<ScoreHeadline", "<StatusOverlay", "styles.explain", "<ScoreOverview", "styles.companiesHeading", "<DetailPanels"].map(marker => screen.indexOf(marker));
  assert.ok(order.every(index => index > 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(read("../app/research/compare/sample/screen.tsx"), /<VerdictHeading[\s\S]*<ScoreHeadline[\s\S]*<StatusOverlay[\s\S]*<ScoreOverview[\s\S]*<DetailPanels/);
});

test("nx9: input rings, radar layering and colours, headline colouring", () => {
  const css = read("../app/research/compare/styles.module.css");
  assert.match(css, /\.pickInput input:focus-visible\{outline:none/);
  assert.match(css, /\.pickInput,\.pickChosen\{border:1px solid #26304a\}/);
  assert.match(css, /\.pickInput:focus-within\{border-color:#d9b56a\}/);
  assert.match(css, /\.companyProfile\{grid-template-columns:184px/);
  const src = read("../app/research/compare/comparison-visuals.tsx");
  assert.ok(src.indexOf('fillOpacity=".16"') < src.indexOf('stroke="#52628a"'));
  assert.ok(src.indexOf('stroke="#52628a"') < src.indexOf('stroke="#3f4d70"'));
  assert.ok(src.indexOf('stroke="#3f4d70"') < src.indexOf("strokeWidth=\"1.8\""));
  assert.match(src, /fill="#a3abc4"/);
});

test("Nov 15 verdict pack: 「総合評価」 label, the winner's code alone in its colour and glow, the gold bar, then the count", () => {
  for (const count of [2, 3]) {
    const companies = sample.companies.slice(0, count), assessment = overallComparison(companies, "ja", now);
    assert.equal(assessment.title, "DEMO-A が優位"); assert.equal(assessment.leader, "DEMO-A");
    const html = renderToStaticMarkup(React.createElement(visuals.VerdictHeading, { ...assessment, companies, lang: "ja", now }));
    const order = ["verdictLabel", "verdictTitle", "verdictBar", "verdictSub"].map(name => html.indexOf(`class="${name}"`));
    assert.ok(order.every(i => i > 0)); assert.deepEqual([...order].sort((x, y) => x - y), order);
    assert.match(html, /<p class="verdictLabel">総合評価<\/p>/);
    assert.match(html, /<h2 class="verdictTitle"><span class="leadTicker" style="color:#ffc247;text-shadow:0 0 16px #ffc2478c">DEMO-A<\/span> が優位<\/h2>/);
    assert.doesNotMatch(html.slice(html.indexOf("verdictSub")), /DEMO-A|color:/, "the count line does not repeat or colour the code");
    assert.match(text(html), count === 3 ? /7項目中\d項目で最も高い点でした$/ : /7項目中5項目で上回りました$/);
  }
  // The second company wins: its own series colour.
  const swapped = [sample.companies[1], sample.companies[0]];
  assert.match(renderToStaticMarkup(React.createElement(visuals.VerdictHeading, { ...overallComparison(swapped, "en", now), companies: swapped, lang: "en", now })), /<p class="verdictLabel">Overall<\/p><h2 class="verdictTitle"><span class="leadTicker" style="color:#4cc9f0;text-shadow:0 0 16px #4cc9f08c">DEMO-A<\/span> leads<\/h2>/);
  // Not enough data: the label stays and the long sentence is one size down.
  const none = renderToStaticMarkup(React.createElement(visuals.VerdictHeading, { title: "必要なデータが揃っていません", companies: sample.companies.slice(0, 2), lang: "ja", now }));
  assert.match(none, /data-verdict="long"/);
  const css = read("../app/research/compare/styles.module.css"), pack = css.slice(css.indexOf("/* ===== Owner, Nov 15: the verdict"));
  assert.match(pack, /\.results \.backToCompare\{[^}]*font-size:12\.5px;font-weight:400;[^}]*color:#7d8a9a\}/);
  assert.match(pack, /\.results \.conclusion\{display:flex;flex-direction:column;align-items:flex-start;gap:4px;/);
  assert.match(pack, /\.verdictLabel\{margin:0;font-size:11px;font-weight:700;letter-spacing:\.18em;[^}]*color:#e2c27a\}/);
  assert.match(pack, /\.verdictTitle\{margin:0;font-size:34px;font-weight:900;line-height:1\.15;/);
  assert.match(pack, /\.verdictBar\{display:block;width:56px;height:3px;[^}]*background:#e2c27a;box-shadow:0 0 10px #e2c27ab3\}/);
  assert.match(pack, /\.verdictSub\{margin:0;font-size:13px;[^}]*color:#c6d0dc\}/);
  for (const file of ["../app/research/compare/screen.tsx", "../app/research/compare/sample/screen.tsx"]) {
    const screen = read(file);
    assert.doesNotMatch(screen, /▶/); assert.match(screen, /<span className=\{styles\.backChevron\} aria-hidden="true">‹<\/span>/);
  }
});
