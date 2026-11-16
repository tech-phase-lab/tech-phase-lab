import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { SAMPLE_FEATURES, SAMPLE_HINTS, SAMPLE_TIME, guardedTarget, hasSample, showStartButton } from "../lib/research/pro-experience-samples.ts";
import { COMPARE_TICKERS, PORTFOLIO_IMAGE, PORTFOLIO_TOTAL_GAIN, PORTFOLIO_TOTAL_GAIN_JPY, compareNow, comparePairs, compareSample, portfolioGainJpy, portfolioHoldings, portfolioMarket } from "../lib/research/pro-experience-sample-data.ts";
import { commonTotals, comparisonAvailability, comparisonMetric, comparisonScores, overallComparison } from "../lib/research/comparison-scorecard.ts";
import { valueHoldings } from "../lib/portfolio/calc.ts";
import { proFeatures } from "../lib/research/pro-experience.ts";
import { OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID } from "../lib/membership/entitlements.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const SAMPLES = "../app/research/pro-experience/samples/";
const sampleFiles = readdirSync(new URL(SAMPLES, import.meta.url)).filter(name => name.endsWith(".tsx"));

test("six features show a sample in place of a video; phone notifications keep the video and RIZEL'S DESK is unchanged", () => {
  assert.deepEqual([...SAMPLE_FEATURES].sort(), ["compare", "financial-radar", "relation-map", "theme-ranking", "us-portfolio", "watch-22"]);
  for (const id of SAMPLE_FEATURES) assert.ok(proFeatures.some(feature => feature.id === id), id);
  assert.equal(hasSample("phone-alerts"), false);
  assert.equal(hasSample("rizels-desk"), false);
  const screen = read("../app/research/pro-experience/screen.tsx");
  assert.match(screen, /\{sample \? <FeatureSample feature=\{sample\} lang=\{lang\} \/> : feature\.videoUrl && <FeatureVideo/);
  assert.equal(SAMPLE_TIME.ja, "2035/03/12 09:00 時点");
  assert.equal(SAMPLE_HINTS["relation-map"].ja, "企業をタップすると、NVDAとのつながりが見られます");
  const frame = read(`${SAMPLES}frame.tsx`), css = read(`${SAMPLES}samples.module.css`);
  assert.match(frame, /サンプル/);
  assert.match(frame, /SAMPLE_TIME\[lang\]/);
  assert.match(frame, /SAMPLE_HINTS\[feature\]\[lang\]/);
  assert.match(css, /\.sampleBox\{[^}]*border:1px dashed/);
});

test("the tour's samples never ask the network: no fetch, no API address, no Next link, no live-data hook", () => {
  assert.ok(sampleFiles.length >= 8);
  for (const name of sampleFiles) {
    const source = read(`${SAMPLES}${name}`);
    for (const banned of [/\bfetch\s*\(/, /\/api\//, /XMLHttpRequest|EventSource|WebSocket|sendBeacon/, /from "next\/link"/,
      /GatedChainMap|useThemeData|useWatchEarnings|QuoteCard|CompanyActivity|useFreshCompanies|PortfolioScreen|ComparisonScreen|RadarScreen/])
      assert.doesNotMatch(source, banned, `${name}: ${banned}`);
    // Data comes only from the committed sample files.
    for (const [, from] of source.matchAll(/from "(@\/lib\/[^"]+)"/g))
      assert.ok(/pro-experience-sample|comparison-scorecard|theme-definitions|theme-ranking|theme-stock-names|portfolio\/calc|chain-map-core|radar|company-watch|watch-earnings/.test(from), `${name} imports ${from}`);
  }
  for (const name of ["compare.json", "portfolio.json", "radar.json", "relation-map-nvda.json", "themes.json", "watch22.json", "watch22-dives.json"]) {
    const file = JSON.parse(read(`../lib/research/pro-experience-samples/${name}`));
    assert.ok(typeof file._source === "string" && file._source.length > 20, `${name} says where its numbers came from`);
  }
  // The real components the samples reuse read nothing in sample mode.
  assert.match(read("../app/research/companies/company-directory.tsx"), /const fresh=useFreshCompanies\(lang,!onOpen\);/);
  assert.match(read("../app/research/companies/use-fresh-companies.ts"), /useEffect\(\(\) => \{\n    if \(!enabled\) return;/);
  assert.match(read("../app/research/themes/parts.tsx"), /onSelect\s*\? <button type="button"/);
  // The data module computes everything with fetch disabled.
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error("no network in the tour"); };
  try {
    for (const pair of comparePairs()) overallComparison(compareSample(pair).companies, "ja", compareNow);
    valueHoldings(portfolioHoldings, portfolioMarket.quotes, portfolioMarket.usdJpy);
  } finally { globalThis.fetch = original; }
  assert.equal(calls, 0);
});

test("Stock Comparison: only NVDA, AMD, INTC and ARM; all six pairs open a scored result", () => {
  assert.deepEqual([...COMPARE_TICKERS], ["NVDA", "AMD", "INTC", "ARM"]);
  const pairs = comparePairs();
  assert.equal(pairs.length, 6);
  assert.equal(new Set(pairs.map(pair => pair.join("-"))).size, 6);
  for (const pair of pairs) {
    const result = compareSample(pair);
    assert.ok(result, pair.join("-"));
    assert.deepEqual(result.companies.map(c => c.ticker), pair);
    assert.ok(result.companies.every(c => c.status === "ready" && c.quarterRevenue && c.preparedAnalysis?.items.length), pair.join("-"));
    assert.ok(commonTotals(result.companies, compareNow).totals.every(total => typeof total === "number"), pair.join("-"));
    const overall = overallComparison(result.companies, "ja", compareNow);
    assert.notEqual(overall.title, "必要なデータが揃っていません", pair.join("-"));
    assert.ok(result.companies.every(c => comparisonScores(c, compareNow).filter(s => s.value !== null).length >= 3), pair.join("-"));
  }
  for (const bad of [["NVDA", "TSM"], ["NVDA", "NVDA"], ["NVDA", "AMD", "INTC"], ["NVDA"], ["MU", "SNDK"]]) assert.equal(compareSample(bad), null, bad.join("-"));
  const ui = read(`${SAMPLES}compare.tsx`);
  assert.match(ui, /COMPARE_TICKERS\.map\(ticker => \{[\s\S]*?<button/);
  assert.doesNotMatch(ui, /<input/);
});

test("US stock portfolio: the holdings match the sample image's table and its +2,301.25 USD total; no upload, no reading service", () => {
  const table = [["AVGO", 10, 351.84, 340.73], ["CRDO", 20, 154.6075, 146.315], ["GLDM", 50, 84.15, 93.81], ["GOOGL", 5, 293.9033, 321.28], ["IREN", 30, 53.9311, 54.11],
    ["MU", 15, 319.255, 365.56], ["NBIS", 100, 94.8982, 100.845], ["QQQ", 10, 601, 610.3699], ["SLV", 40, 71.5225, 85.7723]];
  assert.deepEqual(portfolioHoldings.map(h => [h.ticker, h.shares, h.avgCostUsd, portfolioMarket.quotes[h.ticker].close]), table);
  const { totals, rows } = valueHoldings(portfolioHoldings, portfolioMarket.quotes, portfolioMarket.usdJpy);
  assert.equal(rows.length, 9);
  assert.equal(PORTFOLIO_TOTAL_GAIN, 2301.25);
  assert.equal(Math.round(totals.gainUsd * 100) / 100, 2301.25);
  assert.equal(PORTFOLIO_IMAGE, "/pro-experience/sample-holdings.jpg");
  assert.ok(existsSync(new URL("../public/pro-experience/sample-holdings.jpg", import.meta.url)));
  const ui = read(`${SAMPLES}us-portfolio.tsx`);
  assert.match(ui, /この画像で試す/);
  assert.match(ui, /<Reading ja=\{ja\} stage=\{phase\}/);
  assert.match(ui, /<List [\s\S]*?\bsample onToggleHide=/);
  assert.doesNotMatch(ui, /type="file"|portfolio\/parse|writeHoldings/);
  const list = read("../app/research/portfolio/screen.tsx");
  assert.match(list, /\{!sample && <div className=\{s\.actions\}>/);
  assert.match(list, /onToggleHide \? onToggleHide\(\) : writeHide\(!hide\)/);
});

test("「PROではじめる」 is hidden for PRO members and for the owner's accounts, shown to everyone else once membership is known", () => {
  const base = { settled: true, plan: "free", ownerAccount: false, ownerRole: false };
  assert.equal(showStartButton(base), true);
  assert.equal(showStartButton({ ...base, plan: null }), true);
  assert.equal(showStartButton({ ...base, settled: false }), false);
  assert.equal(showStartButton({ ...base, plan: "pro" }), false);
  // Operator access: the owner's accounts count as PRO in every environment, whatever plan they display.
  assert.ok(OWNER_ACCOUNT_ID && PRODUCTION_OWNER_ACCOUNT_ID);
  assert.equal(showStartButton({ ...base, ownerAccount: true }), false);
  assert.equal(showStartButton({ ...base, ownerRole: true }), false);
  const screen = read("../app/research/pro-experience/screen.tsx");
  assert.match(screen, /owner = useOwnerAccount\(\), ownerRole = useResearchOwner\(\)/);
  assert.match(screen, /PROなら好きな銘柄で使えます/);
  // No gold on the feature pages' frame or text: the PRO tag and the button are green there.
  assert.match(screen, /<ProTag tone="plain" \/>/);
  const css = read("../app/research/pro-experience/styles.module.css");
  assert.match(css, /\.proTagPlain\{[^}]*color:#8fe3c0/);
  assert.doesNotMatch(read(`${SAMPLES}samples.module.css`), /#e3c47e|#c79f4c|#e7c982|#c9a257/i);
});

test("nothing in a sample leads to a real PRO screen: unhandled links only show 「PROで使えます」", () => {
  const link = { tag: "a" };
  const inside = { closest: selector => selector === "a[href], [data-pro-only]" ? link : null };
  assert.equal(guardedTarget(inside, false), link);
  assert.equal(guardedTarget(inside, true), null, "a control the sample handled itself is left alone");
  assert.equal(guardedTarget({ closest: () => null }, false), null);
  assert.equal(guardedTarget(null, false), null);
  const frame = read(`${SAMPLES}frame.tsx`);
  assert.match(frame, /PRO_ONLY = \{ ja: "PROで使えます"/);
  assert.match(frame, /PRO_ONLY_VIEW = \{ ja: "PROで見られます"/);
  assert.match(frame, /event\.preventDefault\(\);\n    show\(\);/);
  assert.match(frame, /onClick=\{guard\}/);
  // 22 stocks: only NVDA and AMD are buttons (they open a deep dive); the other 20 are plain text in the 「一覧 ▾」 list.
  const watch = read(`${SAMPLES}watch-22.tsx`);
  assert.match(watch, /\{dives\.map\(item => <button [^>]*onClick=\{\(\) => setOpen\(item\.ticker\)\}/);
  assert.match(watch, /\{OTHER_TICKERS\.map\(ticker => <li key=\{ticker\}>\{ticker\}<\/li>\)\}/);
  const data = JSON.parse(read("../lib/research/pro-experience-samples/watch22.json"));
  assert.equal(data.companies.length, 22);
  assert.equal(data.summaries, undefined);
  assert.deepEqual(JSON.parse(read("../lib/research/pro-experience-samples/watch22-dives.json")).dives.map(item => item.ticker), ["NVDA", "AMD"]);
  // Theme Ranking: a stock row stays on the page and shows the notice.
  assert.match(read(`${SAMPLES}theme-ranking.tsx`), /<DivergingChart ja=\{ja\} mono onSelect=\{\(\) => proOnly\(\)\}/);
  // The tiles of the 22 stocks have no address to follow in the sample.
  assert.match(read("../app/research/companies/company-directory.tsx"), /\?<a key=\{company\.ticker\} role="button" tabIndex=\{0\}/);
});

// ---- Owner, Nov 16: 「サンプルなのですべて埋めてください」 — no blank, 「—」 or missing value anywhere; dates on the frame's made-up timeline. ----
const SAMPLE_DIR = "../lib/research/pro-experience-samples/";
const SAMPLE_FILES = ["compare.json", "portfolio.json", "radar.json", "relation-map-nvda.json", "themes.json", "watch22.json", "watch22-dives.json"];
const MISSING_TEXT = /—|未取得|未開示|確認できません|そろいません|記載なし|読み取れません|不足|データなし|N\/A|未確認/;

test("Stock Comparison: every factor of every pair has a score and a figure (割安性 and 株価モメンタム included), and every company has a strength and a weakness", () => {
  for (const pair of comparePairs()) {
    const result = compareSample(pair), name = pair.join("-");
    const common = commonTotals(result.companies, compareNow);
    assert.equal(common.ids.length, 7, `${name}: all seven factors are shared`);
    assert.ok(common.totals.every(total => typeof total === "number"), name);
    const overall = overallComparison(result.companies, "ja", compareNow);
    assert.equal(overall.note, undefined, `${name}: the total is not limited to fewer factors`);
    for (const c of result.companies) {
      const scores = comparisonScores(c, compareNow);
      assert.equal(scores.length, 7);
      for (const score of scores) {
        assert.equal(typeof score.value, "number", `${name} ${c.ticker} ${score.id}`);
        for (const lang of ["ja", "en"]) {
          const metric = comparisonMetric(c, score.id, lang, compareNow);
          assert.ok(metric && !MISSING_TEXT.test(metric) && !/unavailable|not available|unverified|not readable|Not enough/i.test(metric), `${name} ${c.ticker} ${score.id}: ${metric}`);
        }
      }
      assert.equal(comparisonAvailability(c, "ja", compareNow), null, `${c.ticker} is complete`);
      const items = c.preparedAnalysis.items;
      assert.ok(items.some(item => item.kind === "strength") && items.some(item => item.kind === "weakness"), `${c.ticker}: no 「該当なし」 box`);
    }
  }
  const metric = ticker => id => comparisonMetric(compareSample([ticker, ticker === "NVDA" ? "AMD" : "NVDA"]).companies[0], id, "ja", compareNow);
  assert.equal(metric("ARM")("valuation"), "予想PER 48.0×");
  assert.equal(metric("NVDA")("momentum"), "約3か月 +14.6%");
  assert.equal(metric("ARM")("stability"), "営業黒字 4/4四半期");
  assert.equal(metric("ARM")("cash"), "簡易FCF率 17.6%");
  // Nothing is left blank, so the sample leaves out the 「— 未取得…」 legend (the real screen keeps it).
  assert.match(read(`${SAMPLES}compare.tsx`), /<ScoreOverview [^>]*missingNote=\{false\}/);
  assert.match(read("../app/research/compare/screen.tsx"), /<ScoreOverview companies=\{result.companies\} lang=\{lang\} now=\{now\}\/>/);
});

test("US stock portfolio: the yen gain is the image's +484,710円, row by row in whole yen, beside the unchanged +2,301.25 USD", () => {
  const { rows, totals } = valueHoldings(portfolioHoldings, portfolioMarket.quotes, portfolioMarket.usdJpy);
  assert.equal(portfolioMarket.usdJpy, 152.4);
  assert.equal(Math.round(totals.gainUsd * 100) / 100, 2301.25);
  assert.equal(PORTFOLIO_TOTAL_GAIN_JPY, 484710);
  assert.equal(Math.round(totals.gainJpy), 484710);
  assert.ok(Number.isFinite(totals.valueJpy));
  for (const row of rows) {
    assert.ok(row.gainJpy !== null && Math.abs(row.gainJpy - portfolioGainJpy[row.ticker]) < 0.5, row.ticker);
    assert.ok(row.avgCostFx > 140 && row.avgCostFx < 160, `${row.ticker} rate ${row.avgCostFx}`);
  }
  assert.equal(rows.reduce((sum, row) => sum + Math.round(row.gainJpy), 0), 484710);
});

test("dates inside the samples belong to the made-up timeline: nothing after 2035/03/12 09:00 and no real 2020s dates; every file says its values are fictional", () => {
  const sampleMoment = Date.parse("2035-03-12T00:00:00.000Z"); // 2035/03/12 09:00 in Japan
  assert.equal(compareNow, sampleMoment);
  const NOT_SHOWN = new Set(["url", "sourceUrl", "quarterSourceUrl", "href", "accession", "sourceRevision", "_source"]);
  for (const name of SAMPLE_FILES) {
    const file = JSON.parse(read(`${SAMPLE_DIR}${name}`));
    assert.match(file._source, /fictional|not real/i, `${name}: _source says the values are made up`);
    const walk = (value, key) => {
      if (Array.isArray(value)) return value.forEach(item => walk(item, key));
      if (value && typeof value === "object") return Object.entries(value).forEach(([k, v]) => walk(v, k));
      if (typeof value !== "string" || NOT_SHOWN.has(key)) return;
      for (const [date] of value.matchAll(/\b20\d\d-\d\d-\d\d(T[\d:.]+Z)?/g)) {
        const at = Date.parse(date);
        assert.ok(at <= sampleMoment && at >= Date.parse("2030-01-01"), `${name} ${key}: ${date}`);
      }
      assert.doesNotMatch(value, /(?<![\d,.$])202\d(?![\d,])/, `${name} ${key}: ${value.slice(0, 80)}`);
    };
    walk(file, "");
  }
  assert.equal(JSON.parse(read(`${SAMPLE_DIR}themes.json`)).asOf, "2035-03-09");
  assert.equal(portfolioMarket.asOf, "2035-03-09");
});
