import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEVERAGED_ETFS, LEVERAGED_SYMBOLS, leveragedRows, sortLeveraged, leveragedPrice, leveragedPercent } from "../lib/research/leveraged-etfs.ts";
import { providers } from "../lib/research/intake.ts";
import { STOCK_LOGOS } from "../lib/research/stock-logos.ts";
import { existsSync } from "node:fs";
import { parseQuote, toFavoriteQuote } from "../lib/research/market-quote.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the レバETF list: the owner's funds (Nov 25), AAOI's 2x long, SNDU for Sandisk, 3x for QQQ / SOXX, and a long fund for every one of the 22 tracked stocks", () => {
  const by = Object.fromEntries(LEVERAGED_ETFS.map(item => [item.etf, item]));
  const owner = { MUU: "MU", SKHL: "SKHY", AMUU: "AMD", NVDL: "NVDA", TSLL: "TSLA", PTIR: "PLTR", MSTU: "MSTR", CONL: "COIN", AVL: "AVGO", TSMX: "TSM", QLD: "QQQ", NBIL: "NBIS", SNDU: "SNDK", RAM: "DRAM" };
  for (const [etf, underlying] of Object.entries(owner)) { assert.equal(by[etf]?.underlying, underlying, etf); assert.equal(by[etf].leverage, 2, etf); }
  assert.deepEqual([by.TQQQ.underlying, by.TQQQ.leverage, by.SOXL.underlying, by.SOXL.leverage], ["QQQ", 3, "SOXX", 3]);
  assert.equal(by.AAOX.underlying, "AAOI");
  const covered = new Set(LEVERAGED_ETFS.map(item => item.underlying));
  assert.deepEqual(providers.map(p => p.ticker).filter(t => !covered.has(t)), []);
  assert.equal(new Set(LEVERAGED_ETFS.map(item => item.etf)).size, LEVERAGED_ETFS.length, "each fund once");
  assert.ok(LEVERAGED_ETFS.every(item => item.leverage === 2 || item.leverage === 3));
  assert.ok(LEVERAGED_SYMBOLS.includes("MRVL") && LEVERAGED_SYMBOLS.includes("MVLL"));
  assert.equal(new Set(LEVERAGED_SYMBOLS).size, LEVERAGED_SYMBOLS.length);
});

test("a row: the fund's price, change and volume, the stock's own day change, and a pre-market / after-hours price only while that session is under way", () => {
  const rows = leveragedRows({
    SKHL: { price: 4.1, percentChange: 39.46, volume: 1000, extended: { price: 3.611, percentChange: -11.93, session: "pre", live: true } },
    SKHY: { price: 120, percentChange: 19.6, volume: 5 },
    MUU: { price: 13.33, percentChange: 38.28, volume: 3000, extended: { price: 11.54, percentChange: -13.43, session: "post", live: false } },
    NVDL: { price: 0, percentChange: 1, volume: 1 },
  });
  assert.deepEqual(rows.map(row => row.etf), ["MUU", "SKHL"]);
  const skhl = rows.find(row => row.etf === "SKHL"), muu = rows.find(row => row.etf === "MUU");
  assert.equal(skhl.underlyingChange, 19.6);
  assert.deepEqual(skhl.extended, { price: 3.611, percentChange: -11.93, session: "pre" });
  assert.equal(muu.extended, null, "an after-hours print that is not current is not shown");
  assert.equal(muu.underlyingChange, null, "MU not read: no change made up");
  assert.equal(leveragedPrice(4.1), "4.100"); assert.equal(leveragedPrice(131.5), "131.50");
  assert.equal(leveragedPercent(39.456), "+39.46%"); assert.equal(leveragedPercent(-11.93), "-11.93%"); assert.equal(leveragedPercent(19.64, 1), "+19.6%");
});

test("上昇率 (first), 下落率 and 出来高 order the rows; a row without the figure goes last", () => {
  const row = (etf, percentChange, volume) => ({ etf, underlying: "X", leverage: 2, price: 1, percentChange, volume, underlyingChange: null, extended: null });
  const rows = [row("A", 5, 10), row("B", -3, 30), row("C", null, null), row("D", 12, 20)];
  assert.deepEqual(sortLeveraged(rows, "gainers").map(r => r.etf), ["D", "A", "B", "C"]);
  assert.deepEqual(sortLeveraged(rows, "losers").map(r => r.etf), ["B", "A", "D", "C"]);
  assert.deepEqual(sortLeveraged(rows, "volume").map(r => r.etf), ["B", "D", "A", "C"]);
  const list = read("app/research/price/leveraged-list.tsx");
  assert.match(list, /useState<LeveragedSort>\("gainers"\)/);
  assert.match(read("lib/research/leveraged-etfs.ts"), /LEVERAGED_SORTS: readonly LeveragedSort\[\] = \["gainers", "losers", "volume"\]/);
});

test("the tab comes after 半導体ETF, draws no chart, credits Twelve Data at the bottom, and uses no gold (FREE page)", () => {
  const board = read("app/research/price/market-board.tsx");
  assert.ok(board.indexOf('{ id: "semi", ja: "半導体ETF"') < board.indexOf('const LEVERAGED = { id: "lev", ja: "レバETF", en: "Leveraged ETFs" }'));
  assert.match(board, /CATEGORIES\.map\(item => <button[^\n]*\n\s*<button type="button" aria-pressed=\{lev\}[^\n]*LEVERAGED\.ja : LEVERAGED\.en/);
  assert.match(board, /\{lev \? <LeveragedList ja=\{ja\} \/> : <>/);
  assert.match(board, /if \(lev\) return;/, "no chart read while the list is shown");
  assert.match(board, /lev \? t\("提供：Twelve Data", "Data: Twelve Data"\)/);
  const list = read("app/research/price/leveraged-list.tsx");
  assert.match(list, /`\$\{row\.leverage\}倍`/); assert.match(list, /`\$\{row\.leverage\}x`/);
  assert.match(list, /t\("プレ", "Pre"\)/);
  assert.doesNotMatch(list, /row\.name\b/, "no company or fund name");
  const css = read("app/research/price/leveraged.module.css");
  assert.doesNotMatch(css, /#d9b46a|#e0b25c|text-overflow|ellipsis/i);
  assert.match(css, /\.up\{color:#4fe3a6\}\.down\{color:#ff7b7b\}/);
});

test("the quotes are batched, leased and shared: one cached copy for everyone, at most 48 provider symbols a request, and the route is public", () => {
  const data = read("lib/research/market-data.ts");
  assert.match(data, /name: "md-lev-v1", slotMs: Math\.max\(LEVERAGED_SLOT_MS, quoteSlotMs\("AAPL", now\)\)/);
  assert.match(data, /sharedReader\.readMany<MarketQuote>\(leveragedSpec\(Date\.now\(\)\), \[\.\.\.symbols\], group => fetchQuotes\(group\), \{ maxFetch: LEVERAGED_MAX_FETCH \}\)/);
  assert.match(data, /LEVERAGED_SLOT_MS = 2 \* 60_000, LEVERAGED_MAX_FETCH = 48/);
  // fetchQuotes is the batched, prepost quote through twelveCall (the allocator's lease).
  assert.match(data, /call\("quote", \{ symbol: group\.join\(","\), prepost: "true" \}, tier\)/);
  const route = read("app/api/research/market/leveraged/route.ts");
  assert.doesNotMatch(route, /getMembership|auth\(\)|isPro/, "FREE: nobody is turned away, the owner included");
  assert.match(read("tests/api-access-guard.test.mjs"), /'research\/market\/leveraged':/);
});

test("logos: one normalized tile per ticker in public/logos (same size and padding); a ticker without a readable logo shows its letters (owner, Nov 25)", () => {
  for (const t of ["MU", "SNDK", "MRVL", "NVDA", "AMD", "GOOGL", "NBIS"]) { assert.ok(STOCK_LOGOS.has(t), t); assert.ok(existsSync(new URL(`../public/logos/${t}.png`, import.meta.url)), t); }
  for (const t of ["TSM", "LITE", "SMCI", "ASTS"]) assert.ok(!STOCK_LOGOS.has(t), `${t} shows its letters`);
  for (const t of STOCK_LOGOS) assert.ok(existsSync(new URL(`../public/logos/${t}.png`, import.meta.url)), t);
  const logo = read("app/research/watchlist/stock-logo.tsx");
  assert.match(logo, /const usable = hasLogo\(ticker\) && failed !== ticker;/);
  assert.match(logo, /`\/logos\/\$\{encodeURIComponent\(ticker\)\}\.png`/);
  assert.match(logo, /: full \? <span style=\{fullSize\(ticker\)\}>\{ticker\}<\/span> : ticker\.slice\(0, 2\)/);
  for (const path of ["app/research/watchlist/stock-logo.tsx", "app/research/stocks/stock-theme-discovery.tsx"]) assert.doesNotMatch(read(path), /s2\/favicons/);
  assert.match(read("app/research/watchlist/watchlist.module.css"), /\.rowLogo img \{ width:100%;height:100%;display:block; \}/);
  assert.match(read("scripts/logos/normalize_logos.py"), /SIZE, PAD = 72, 11/);
});

test("adding a stock keeps the other rows' prices and charts on the screen while the new request is answered", () => {
  const market = read("app/research/price/use-market.ts");
  assert.match(market, /return state\.url === url \? state : \{ data: keep \? state\.data : null, failed: false, loaded: false \};/);
  assert.match(read("app/research/watchlist/watchlist.tsx"), /useQuotes\(favorites\.slice\(0, 100\), true, true, true\)/);
});

test("an after-hours price without the provider's percentage keeps its row's 「時間外」, measured from the regular close", () => {
  const NOW = Date.parse("2026-11-25T00:31:00Z"); // 19:31 ET, after-hours
  const raw = { symbol: "MRVL", close: "131.57", percent_change: "-9.1", is_market_open: false, timestamp: 1795636800, extended_price: "131.01", extended_timestamp: NOW / 1000 - 50 * 60 };
  const fav = toFavoriteQuote(parseQuote(raw, "MRVL"), [], NOW);
  assert.equal(fav.extended.session, "post");
  assert.equal(fav.extended.live, true, "a print 50 minutes old is still the after-hours price");
  assert.ok(Math.abs(fav.extended.percentChange - (131.01 - 131.57) / 131.57 * 100) < 1e-9);
});
