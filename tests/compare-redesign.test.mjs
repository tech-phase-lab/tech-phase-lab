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
const sample = buildComparisonSample(), now = Date.parse(sample.generatedAt);
const text = html => html.replace(/<[^>]+>/g, "");

test("two companies: the big scores are shown, the higher one's frame is gold, and a sentence counts the factors won from the scores", () => {
  const html = renderToStaticMarkup(React.createElement(visuals.ScoreHeadline, { companies: sample.companies.slice(0, 2), lang: "ja", now }));
  assert.match(html, /<b>8\.3<\/b>/); assert.match(html, /<b>6\.0<\/b>/);
  assert.equal((html.match(/data-leader="true"/g) ?? []).length, 1);
  assert.match(html.split('data-leader="true"')[0].split("<article").at(-1), /^ class="scoreBox"/, "the first card is the leader");
  assert.match(text(html), /DEMO-Aが7項目中5項目で上回りました/);
  assert.match(text(renderToStaticMarkup(React.createElement(visuals.ScoreHeadline, { companies: sample.companies.slice(0, 2), lang: "en", now }))), /DEMO-A scored higher in 5 of 7 factors/);
});

test("a factor with equal scores is not counted as won", () => {
  const [a, b] = sample.companies;
  // Same company twice with a different ticker: every factor ties, so nobody wins anything and there is no sentence or gold frame.
  const twin = { ...a, ticker: "TWIN", name: "Twin" };
  const html = renderToStaticMarkup(React.createElement(visuals.ScoreHeadline, { companies: [a, twin], lang: "ja", now }));
  assert.doesNotMatch(html, /data-leader="true"/);
  assert.doesNotMatch(text(html), /項目で上回りました/);
  // Against a company that ties on some factors, only the strictly higher ones count (5 of the 7, as the scores say).
  const wins = a && b ? text(renderToStaticMarkup(React.createElement(visuals.ScoreHeadline, { companies: [a, b], lang: "ja", now }))).match(/7項目中(\d)項目/)[1] : "";
  assert.equal(wins, "5");
});

test("the status overlay draws every company in its own colour, and factors without a score are not drawn", () => {
  const html = renderToStaticMarkup(React.createElement(visuals.StatusOverlay, { companies: sample.companies, lang: "ja", now }));
  for (const color of ["#f2c36b", "#8da2ff", "#c9a0ff"]) assert.ok(html.includes(`fill="${color}"`), color);
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
  assert.match(html, /未取得・評価保留（0点ではありません）/);
});

test("each company card keeps its strengths, weaknesses and status; nothing is cut with an ellipsis", () => {
  const html = renderToStaticMarkup(React.createElement(visuals.CompanyScoreCard, { company: sample.companies[0], lang: "ja", now, colorIndex: 0 }));
  assert.match(text(html), /Atlas Demo/); assert.match(text(html), /長所/); assert.match(text(html), /短所/);
  const css = read("../app/research/compare/styles.module.css");
  const mine = css.slice(css.indexOf("/* ===== 銘柄比較PRO: gold on navy"));
  assert.doesNotMatch(mine, /text-overflow:ellipsis/);
  // nx9: one item is one line (12px; 11px when long), never cut with "…".
  assert.match(mine, /\.traitBox li\{[^}]*font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:clip/);
  assert.match(mine, /\.traitBox li\[data-fit="small"\]\{font-size:11px\}/);
});

test("the palette is navy and gold: card gradient, edge, gold button, and 120px or more of room under the last button", () => {
  const css = read("../app/research/compare/styles.module.css");
  const mine = css.slice(css.indexOf("/* ===== 銘柄比較PRO: gold on navy"));
  assert.match(mine, /\.pickCard\{[^}]*border:1px solid #2a3652[^}]*linear-gradient\(160deg,#16233a,#0e1522\)/);
  assert.match(mine, /\.pickSubmit button\{[^}]*linear-gradient\(180deg,#e3c47e,#c79f4c\)[^}]*color:#2a1f08/);
  assert.match(mine, /\.screenWrap\{padding-bottom:(1[2-9]\d|[2-9]\d\d)px\}/);
  assert.match(mine, /#d9b56a/);
  assert.doesNotMatch(mine, /#[0-9a-f]{3,6}\b[^;{}]*brown/i);
  for (const color of ["#f2c36b", "#8da2ff", "#c9a0ff"]) assert.ok(read("../app/research/compare/comparison-visuals.tsx").includes(color), color);
});

test("the input screen: three headings, chosen companies as cards with a colour mark, ticker in bold, name, ×; ticker search is one closed line", () => {
  const screen = read("../app/research/compare/screen.tsx");
  for (const text of ["3社目（任意）", "会社名・銘柄コードで追加", "この銘柄を比較する", "社を選択"]) assert.ok(screen.includes(text), text);
  assert.match(screen, /styles\.pickChosen/);
  assert.match(screen, /\["#f2c36b", "#8da2ff", "#c9a0ff"\]\[i\]/);
  assert.match(screen, /styles\.pickRemove/);
  const search = read("../app/research/compare/ticker-search.tsx");
  assert.match(search, /<summary>\{t\("ティッカー検索", "Find a ticker"\)\}<\/summary>/);
  assert.doesNotMatch(search, /tickerHelpTitle/);
  assert.doesNotMatch(search, /<details[^>]*\bopen\b/);
});

test("the result is ordered: headline, scores, sentence, overlay, explanation, snapshot, then companies, then the two detail buttons", () => {
  const screen = read("../app/research/compare/screen.tsx");
  const order = ["<ScoreHeadline", "<StatusOverlay", "styles.explain", "<ScoreOverview", "styles.companiesHeading", "<DetailPanels"].map(marker => screen.indexOf(marker));
  assert.ok(order.every(index => index > 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(read("../app/research/compare/sample/screen.tsx"), /<ScoreHeadline[\s\S]*<StatusOverlay[\s\S]*<ScoreOverview[\s\S]*<DetailPanels/);
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
  const html = renderToStaticMarkup(React.createElement(visuals.LeadTitle, { title: "総合評価はDEMO-Aが優位", companies: sample.companies }));
  assert.match(html, /総合評価は<b[^>]*color:#f2c36b[^>]*>DEMO-A<\/b>が優位/);
});
