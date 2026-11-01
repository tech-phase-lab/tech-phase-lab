import test from "node:test";
import assert from "node:assert/strict";
import { valueHoldings, weights } from "../lib/portfolio/calc.ts";
import { extractJson, normalizeParsed, reconcile } from "../lib/portfolio/parse.ts";

// Read from a real holdings screen (Rakuten iSPEED, 8 rows); the screen's own total gain was +515,600.53 USD.
const SCREEN = { reportedGainUsd: 515600.53, holdings: [
  { ticker: "AAOI", name: "アプライド・…", shares: 250, avgCostUsd: 156.876, currentPriceUsd: 157.73 },
  { ticker: "ALAB", name: "アステラ・ラ…", shares: 150, avgCostUsd: 238.7933, currentPriceUsd: 341.43 },
  { ticker: "AMD", name: "アドバンスト…", shares: 40, avgCostUsd: 425.05, currentPriceUsd: 493.41 },
  { ticker: "APH", name: "アンフェノール", shares: 100, avgCostUsd: 149.97, currentPriceUsd: 148.7897 },
  { ticker: "GLDM", name: "SPDR ゴール…", shares: 500, avgCostUsd: 90.817, currentPriceUsd: 88.9627 },
  { ticker: "MU", name: "マイクロン…", shares: 300, avgCostUsd: 376.2003, currentPriceUsd: 1019.39 },
  { ticker: "NBIS", name: "ネビウス・グ…", shares: 2000, avgCostUsd: 94.8982, currentPriceUsd: 245.8299 },
  { ticker: "VRT", name: "バーティブ・…", shares: 40, avgCostUsd: 234.55, currentPriceUsd: 321.6 },
] };

test("the screenshot rows are accepted and their profit adds up to the figure printed on the screen", () => {
  const parsed = normalizeParsed(SCREEN);
  assert.equal(parsed.holdings.length, 8);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(reconcile(parsed), null);
});

test("a missed row is caught by the cross-check against the printed profit", () => {
  const parsed = normalizeParsed({ ...SCREEN, holdings: SCREEN.holdings.slice(0, 7) });
  assert.match(reconcile(parsed), /合いません/);
});

test("doubtful rows become warnings instead of numbers; duplicates are merged and flagged", () => {
  const parsed = normalizeParsed({ holdings: [
    { ticker: "nvda", shares: "1,000", avgCostUsd: "120.5" },
    { ticker: "NVDA", shares: 1000, avgCostUsd: 120.5 },
    { ticker: "BAD TICKER", shares: 1, avgCostUsd: 1 },
    { ticker: "TSLA", shares: -5, avgCostUsd: 10 },
    { ticker: "AAPL", shares: 5, avgCostUsd: 0 },
    { ticker: "META", shares: 5, avgCostUsd: null, avgCostJpy: 90000 },
    "junk", null,
  ] });
  assert.deepEqual(parsed.holdings.map(h => [h.ticker, h.shares, h.avgCostUsd]), [["NVDA", 1000, 120.5]]);
  assert.ok(parsed.warnings.length >= 5);
  assert.deepEqual(normalizeParsed(null).holdings, []);
  assert.deepEqual(normalizeParsed({ holdings: "x" }).holdings, []);
});

test("the purchase exchange rate is derived only when the yen cost is shown and plausible", () => {
  const ok = normalizeParsed({ holdings: [{ ticker: "NVDA", shares: 1, avgCostUsd: 100, avgCostJpy: 15000 }] });
  assert.equal(ok.holdings[0].avgCostFx, 150);
  const absurd = normalizeParsed({ holdings: [{ ticker: "NVDA", shares: 1, avgCostUsd: 100, avgCostJpy: 15 }] });
  assert.equal(absurd.holdings[0].avgCostFx, undefined);
});

test("valuation: dollars always, yen value with today's rate, yen profit only with the purchase rate", () => {
  const holdings = [{ ticker: "NVDA", shares: 10, avgCostUsd: 100, avgCostFx: 140 }, { ticker: "AMD", shares: 5, avgCostUsd: 200 }];
  const quotes = { NVDA: { ticker: "NVDA", close: 150, asOf: "2026-10-30" }, AMD: { ticker: "AMD", close: 180, asOf: "2026-10-30" } };
  const { rows, totals } = valueHoldings(holdings, quotes, 150);
  assert.equal(rows[0].valueUsd, 1500);
  assert.equal(rows[0].gainUsd, 500);
  assert.equal(rows[0].gainPct, 50);
  assert.equal(rows[0].valueJpy, 225000);
  assert.equal(rows[0].gainJpy, 225000 - 1000 * 140);
  assert.equal(rows[1].gainJpy, null, "no purchase rate: the yen profit is not guessed");
  assert.equal(totals.valueUsd, 2400);
  assert.equal(totals.gainUsd, -100 + 500);
  assert.equal(totals.valueJpy, 360000);
  assert.equal(totals.gainJpy, null);
});

test("totals are withheld while any price is missing, never computed from a partial list", () => {
  const { totals } = valueHoldings([{ ticker: "NVDA", shares: 1, avgCostUsd: 1 }, { ticker: "AMD", shares: 1, avgCostUsd: 1 }], { NVDA: { ticker: "NVDA", close: 2, asOf: "d" } }, 150);
  assert.equal(totals.missingPrices, 1);
  assert.equal(totals.valueUsd, null);
  assert.equal(totals.gainUsd, null);
  assert.deepEqual(valueHoldings([], {}, 150).totals.valueUsd, null);
});

test("weights add up to 100 and are sorted largest first", () => {
  const { rows } = valueHoldings([{ ticker: "A", shares: 1, avgCostUsd: 1 }, { ticker: "B", shares: 3, avgCostUsd: 1 }], { A: { ticker: "A", close: 10, asOf: "d" }, B: { ticker: "B", close: 10, asOf: "d" } }, null);
  const result = weights(rows);
  assert.deepEqual(result.map(r => r.ticker), ["B", "A"]);
  assert.equal(Math.round(result.reduce((s, r) => s + r.percent, 0)), 100);
});

test("the model's JSON is found inside fences or chatter, and broken output is rejected", () => {
  assert.deepEqual(extractJson('はい。\n```json\n{"holdings":[{"ticker":"A","note":"}"}]}\n```'), { holdings: [{ ticker: "A", note: "}" }] });
  assert.equal(extractJson("no json here"), null);
  assert.equal(extractJson('{"holdings": [oops'), null);
});

import { readFile } from "node:fs/promises";
import { parseStored, serialize } from "../lib/portfolio/store.ts";
const src = path => readFile(new URL(path, import.meta.url), "utf8");

test("stored holdings round-trip, and damaged or out-of-range data is dropped", () => {
  const holdings = [{ ticker: "NVDA", shares: 10, avgCostUsd: 100, avgCostFx: 150 }];
  assert.deepEqual(parseStored(serialize(holdings)), holdings);
  assert.deepEqual(parseStored(""), []);
  assert.deepEqual(parseStored("{broken"), []);
  assert.deepEqual(parseStored(JSON.stringify({ version: 2, holdings })), []);
  assert.deepEqual(parseStored(JSON.stringify({ version: 1, holdings: [{ ticker: "bad ticker", shares: 1, avgCostUsd: 1 }, { ticker: "A", shares: -1, avgCostUsd: 1 }, { ticker: "B", shares: 1, avgCostUsd: 1, avgCostFx: 5 }] })), [{ ticker: "B", shares: 1, avgCostUsd: 1 }]);
});

test("the screenshot route is same-origin, signed-in, limited and does not store the picture", async () => {
  const route = await src("../app/api/research/portfolio/parse/route.ts");
  assert.match(route, /request\.headers\.get\("origin"\) !== new URL\(request\.url\)\.origin/);
  assert.match(route, /await auth\(\)/);
  assert.match(route, /takeRead\(userId\)/);
  assert.match(route, /Cache-Control": "private, no-store"/);
  assert.doesNotMatch(route, /console\.|writeFile|localStorage/);
  const vision = await src("../lib/portfolio/vision.ts");
  assert.match(vision, /api\.openai\.com\/v1\/responses/);
  assert.match(vision, /store: false/);
  assert.match(vision, /PORTFOLIO_OPENAI_API_KEY \|\| process\.env\.RESOLUTE_OPENAI_API_KEY/);
  assert.match(vision, /temperature: 0/);
  assert.match(vision, /MAX_IMAGE_BYTES/);
  assert.doesNotMatch(vision, /console\./);
  const limit = await src("../lib/portfolio/limit.ts");
  assert.match(limit, /DAILY_READS = 10/);
  assert.match(limit, /isOwnerAccount\(userId\)/);
});

test("the quotes route is signed-in only and validates every ticker", async () => {
  const route = await src("../app/api/research/portfolio/quotes/route.ts");
  assert.match(route, /await auth\(\)/);
  assert.match(route, /TICKER_PATTERN\.test/);
  assert.match(route, /tickers\.length > 60/);
});

test("holdings never leave the browser: the screen stores them locally and sends only tickers for prices", async () => {
  const screen = await src("../app/research/portfolio/screen.tsx");
  assert.match(screen, /tickers=\$\{encodeURIComponent\(tickers\)\}/);
  assert.doesNotMatch(screen, /JSON\.stringify\(\{ holdings|body: JSON\.stringify\(holdings/);
  assert.match(screen, /金額を伏せる/);
  const header = await src("../app/research/site-header.tsx");
  assert.match(header, /item\("\/research\/portfolio", "bars"/);
  assert.ok(header.indexOf('heading(ja ? "マイページ"') > header.indexOf('heading(ja ? "リサーチ"'), "the My page group stays below Research");
});

test("the portfolio is PRO only: hidden from the FREE menu, redirected on the page, and refused by both APIs", async () => {
  const header = await src("../app/research/site-header.tsx");
  assert.match(header, /\{member && item\("\/research\/portfolio"/);
  const page = await src("../app/research/portfolio/page.tsx");
  assert.match(page, /member\.plan !== "pro"\) redirect\("\/research"\)/);
  for (const path of ["../app/api/research/portfolio/parse/route.ts", "../app/api/research/portfolio/quotes/route.ts"]) {
    const route = await src(path);
    assert.match(route, /getMembership\(\)\)\.plan !== "pro"\) return json\(\{ error: "pro-only" \}, 403\)/, path);
  }
  assert.match(await src("../app/research/plan-cards.tsx"), /米国株の資産管理/);
  assert.match(await src("../app/research/account/account-view.tsx"), /米国株の資産管理/);
});

test("a real row with an unreadable number is kept as incomplete (to be typed in), not silently dropped", () => {
  const parsed = normalizeParsed({ holdings: [
    { ticker: "NVDA", name: "NVIDIA", shares: 40, avgCostUsd: 112.5 },
    { ticker: "MU", name: "Micron Technology", shares: null, avgCostUsd: 98.4 },
    { ticker: "ALAB", shares: 10, avgCostUsd: null },
  ] });
  assert.deepEqual(parsed.holdings.map(h => h.ticker), ["NVDA"]);
  assert.deepEqual(parsed.incomplete.map(r => [r.ticker, r.shares, r.avgCostUsd]), [["MU", null, 98.4], ["ALAB", 10, null]]);
  assert.ok(parsed.warnings.some(w => w.startsWith("MU の株数を読み取れませんでした")));
  assert.equal(reconcile({ ...parsed, reportedGainUsd: 1, screenPrices: { NVDA: 1 } }), null, "no cross-check while a row is incomplete");
});

test("the screen follows the design: black and gold, the states, and the hide rule (only the total and the dollar profit are masked)", async () => {
  const screen = await src("../app/research/portfolio/screen.tsx");
  for (const text of ["スクショを選ぶだけで、", "読み取っています", "内容の確認", "要確認", "持ち株 ", "金額を表示する", "終値を取得できませんでした", "もう一度取得する", "今日の読み込みは", "手入力で追加", "取得時の為替(USD/JPY)", "投資助言ではありません。", "為替が分かる銘柄のみ"]) assert.ok(screen.includes(text), text);
  // Hidden: the total and the dollar profit amount only.
  assert.match(screen, /hide \? <b className=\{`\$\{s\.big\} \$\{s\.mask\}`\}>\{MASK\}<\/b>/);
  assert.match(screen, /hide \? MASK : `\$\{sign\(totals\.gainUsd\)\}/);
  assert.doesNotMatch(screen, /hide \? MASK : usd\(row/, "the cards are never masked");
  // The honest progress: the price step is shown as waiting, not as running.
  assert.match(screen, /data-state="wait"><i \/>終値と為替を取得します/);
  const css = await src("../app/research/portfolio/portfolio.module.css");
  assert.match(css, /--gold:#e7c982/);
  assert.match(css, /prefers-reduced-motion/);
});

test("the screen order of the rows is kept, including rows with a missing number", () => {
  const parsed = normalizeParsed({ holdings: [
    { ticker: "NVDA", shares: 40, avgCostUsd: 112.5 }, { ticker: "AVGO", shares: 12, avgCostUsd: 210 },
    { ticker: "MU", shares: null, avgCostUsd: 98.4 }, { ticker: "MSFT", shares: 8, avgCostUsd: 420 } ] });
  assert.deepEqual(parsed.order, ["NVDA", "AVGO", "MU", "MSFT"]);
});

test("the manual form finds stocks by Japanese company name through the same search as the stock search page", async () => {
  const { searchStocks } = await import("../lib/research/stock-search.ts");
  const entries = [{ ticker: "NVDA", name: "NVIDIA CORP", cik: 1045810 }, { ticker: "MU", name: "MICRON TECHNOLOGY INC", cik: 723125 }];
  assert.equal(searchStocks(entries, "エヌビディア", 5)[0]?.ticker, "NVDA");
  assert.equal(searchStocks(entries, "マイクロン", 5)[0]?.ticker, "MU");
  const screen = await src("../app/research/portfolio/screen.tsx");
  assert.match(screen, /\/api\/research\/stocks\?q=/);
  assert.match(screen, /日本語の会社名でも探せます/);
  assert.match(await src("../app/api/research/stocks/route.ts"), /searchDirectory\(entries, query/);
});

test("a failed call to the reading service is told apart from an unreadable picture, with a safe reason", async () => {
  const route = await src("../app/api/research/portfolio/parse/route.ts");
  assert.match(route, /\^vision-\[a-z0-9_\.:-\]\{1,64\}\$/i);
  const vision = await src("../lib/portfolio/vision.ts");
  assert.match(vision, /async function providerReason/);
  assert.doesNotMatch(vision, /console\./);
  const screen = await src("../app/research/portfolio/screen.tsx");
  assert.match(screen, /response\.status === 400 \? "unreadable" : "service"/);
  assert.match(screen, /スクショから持ち株を<br \/>読み取れませんでした/);
  assert.doesNotMatch(screen, /読み取れませんでした。<\/h2>|上限に達しました。<\/h2>/, "no full stop in the headings");
  const header = await src("../app/research/site-header.tsx");
  assert.ok(header.indexOf('heading(ja ? "マイページ"') > header.indexOf('heading(ja ? "リサーチ"'), "My page is back below Research");
});

test("the portfolio APIs run behind the sign-in middleware (without it the session cannot be read and every call fails)", async () => {
  const proxy = await src("../proxy.ts");
  assert.match(proxy, /"\/api\/research\/portfolio\/:path\*"/);
  const screen = await src("../app/research/portfolio/screen.tsx");
  assert.match(screen, /response\.status === 400 \? "unreadable" : "service"/);
  assert.match(screen, /http-\$\{response\.status\}/);
});

test("the confirmation screen does not repeat the not-advice line under the register button", async () => {
  const screen = await src("../app/research/portfolio/screen.tsx");
  assert.match(screen, /\{!review && <p className=\{s\.disclaimer\}>/);
});
