import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { asOfLabel, searchCardQuote, searchResultName, searchExtendedLine, searchQuoteTickers, searchResultTag, tagNeedsProfile } from "../lib/research/search-result-card.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
// Tue Nov 24 2026, 17:00 ET: after-hours trading is under way.
const AFTER = Date.parse("2026-11-24T22:00:00Z");
const quote = (extra = {}) => ({ ticker: "NVDA", price: 155.38, change: -9.67, percentChange: -5.86, currency: "USD", asOf: "2026-11-24T21:00:00Z", session: "closed", delayed: false, source: "twelve-data", ...extra });
const ext = { price: 156.1, percentChange: 0.46, asOf: "2026-11-24T21:58:00Z", session: "post", live: true };

test("the card's tag is the watchlist's tag, with 「レバETF」 for the long 2x / 3x funds", () => {
  assert.deepEqual(searchResultTag("MU"), { ja: "メモリ", en: "Memory" }, "the watchlist's theme list");
  assert.deepEqual(searchResultTag("NVDA", { ja: "半導体", en: "Semiconductors" }), { ja: "半導体", en: "Semiconductors" }, "the roster's sector");
  assert.deepEqual(searchResultTag("NVO", undefined, { ja: "医薬品", en: "Pharmaceuticals" }), { ja: "医薬品", en: "Pharmaceuticals" }, "the SEC SIC label");
  assert.deepEqual(searchResultTag("NVDL"), { ja: "レバETF", en: "Leveraged ETF" });
  assert.equal(searchResultTag("ZZZZ"), undefined);
  assert.equal(tagNeedsProfile("MU"), false);
  assert.equal(tagNeedsProfile("NVDL"), false, "no SEC read for a fund the list already names");
  assert.equal(tagNeedsProfile("NVDA", { ja: "半導体", en: "Semiconductors" }), false);
  assert.equal(tagNeedsProfile("NVO"), true);
  assert.equal(searchResultName("NVDL", "GraniteShares 2x Long NVDA Daily ETF", "ja"), "NVDA 2倍ETF");
  assert.equal(searchResultName("SOXL", "Direxion Daily Semiconductor Bull 3X Shares", "en"), "SOXX 3x ETF");
  assert.equal(searchResultName("NVDA", "NVIDIA", "ja"), "NVIDIA");
});

test("「時間外 +0.46%」 only while that session is under way and the quote has extended data", () => {
  assert.deepEqual(searchExtendedLine(quote({ extended: ext }), AFTER), { session: "post", percentChange: 0.46 });
  assert.equal(searchExtendedLine(quote(), AFTER), null, "no extended data: no line");
  assert.equal(searchExtendedLine(quote({ extended: { ...ext, live: false } }), AFTER), null);
  assert.equal(searchExtendedLine(quote({ extended: ext }), Date.parse("2026-11-25T15:00:00Z")), null, "next morning's regular session");
  assert.equal(searchExtendedLine(quote({ session: "regular", extended: ext }), AFTER), null);
  assert.equal(searchExtendedLine(null, AFTER), null);
});

test("prices and sparklines are read only for cards that have been on screen", () => {
  const results = [{ ticker: "NVDA" }, { ticker: "NVDL" }, { ticker: "NVMI" }, { ticker: "NVDA" }, { ticker: "bad ticker" }];
  assert.deepEqual(searchQuoteTickers(results, new Set(["NVMI", "NVDA", "bad ticker"])), ["NVDA", "NVMI"]);
  assert.deepEqual(searchQuoteTickers(results, new Set()), []);
  assert.equal(searchQuoteTickers(Array.from({ length: 40 }, (_, i) => ({ ticker: `A${i}` })), new Set(Array.from({ length: 40 }, (_, i) => `A${i}`))).length, 30);
  assert.equal(searchCardQuote(quote(), "NVDL"), null, "a quote for another ticker is never shown");
  assert.equal(searchCardQuote(quote(), "NVDA").price, 155.38);
});

test("the time line is 「14:59 時点」 / \"As of 14:59\"", () => {
  assert.equal(asOfLabel("14:59", "ja"), "14:59 時点");
  assert.equal(asOfLabel("14:59", "en"), "As of 14:59");
  const page = read("../app/research/stocks/stock-directory.tsx");
  assert.doesNotMatch(page, /表示取得時刻/);
  assert.match(page, /asOfLabel\(displayClock\(asOf, lang\), lang\)/);
});

test("result cards reuse the watchlist's sparkline, tag, logo and quotes path; history is one scrolling row", () => {
  const rows = read("../app/research/stocks/search-rows.tsx"), css = read("../app/research/stocks/search-redesign.module.css");
  const history = read("../app/research/stocks/stock-search-history.tsx"), historyCss = read("../app/research/stocks/stock-search-history.module.css");
  assert.match(rows, /<AreaChart [^>]*levels=\{false\}/);
  assert.match(rows, /useWatchlistSectors\(/);
  assert.match(rows, /<StockLogo /);
  assert.match(rows, /useQuotes\(tickers, true, false, true\)/);
  assert.match(rows, /IntersectionObserver/);
  assert.match(rows, /ja \? "時間外" : "After"/);
  assert.doesNotMatch(rows, /…/);
  assert.match(css, /\.row\{[^}]*height:88px/);
  assert.match(css, /\.quote\{[^}]*font-variant-numeric:tabular-nums/);
  assert.match(css, /\.nameLine\{[^}]*flex-wrap:wrap/);
  assert.doesNotMatch(css, /\.tag\{[^}]*text-overflow:ellipsis/);
  assert.doesNotMatch(history, /aria-expanded|ResizeObserver\(update\);\s*observer\.observe\(element\);\s*for/);
  assert.match(historyCss, /\.list\{[^}]*flex-wrap:nowrap[^}]*overflow-x:auto/);
  assert.match(historyCss, /\.list\[data-more\]\{[^}]*mask-image:linear-gradient/);
  const chart = read("../app/research/watchlist/area-chart.tsx");
  assert.match(chart, /\{levels && <text/);
});
