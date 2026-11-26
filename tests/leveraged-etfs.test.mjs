import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEVERAGED_ETFS, LEVERAGED_GIVE_UP, LEVERAGED_PER_RUN, LEVERAGED_START, LEVERAGED_SYMBOLS, leveragedAsOf, leveragedCreditsPerDay, leveragedDue, leveragedRows, nextLeveragedView, sortLeveraged, leveragedPrice, leveragedPercent } from "../lib/research/leveraged-etfs.ts";
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
  assert.match(board, /CATEGORIES\.map\(item => <button[^\n]*\n\s*<button type="button" aria-pressed=\{lev\}[^\n]*<TabIcon id=\{LEVERAGED\.id\} \/><span data-tab-label>\{ja \? LEVERAGED\.ja : LEVERAGED\.en\}/);
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

test("one shared snapshot: refreshed by the site's minute job through the allocator, members only read it, and the route is public", () => {
  const data = read("lib/research/market-data.ts");
  assert.match(data, /const LEVERAGED_SNAPSHOT_SPEC: ReadSpec = \{ name: "md-lev-snap-v1", slotMs: 60_000, staleMs: STALE_LIMIT_MS \}/);
  assert.match(data, /sharedReader\.read<LevSnapshot>\(LEVERAGED_SNAPSHOT_SPEC, "all", null\)/, "a member's read never fetches");
  assert.match(data, /const due = leveragedDue\(ages, stocksTrading\(now\)\);/);
  assert.match(data, /const values = await fetchQuotes\(group\)/);
  // fetchQuotes is the batched, prepost quote through twelveCall (the allocator's lease).
  assert.match(data, /call\("quote", \{ symbol: group\.join\(","\), prepost: "true" \}, tier\)/);
  assert.match(data, /await sharedReader\.save\(LEVERAGED_SNAPSHOT_SPEC, "all", /, "written again every minute (the newest copy is in this or the last minute's slot)");
  const route = read("app/api/research/market/leveraged/route.ts");
  assert.match(route, /await loadLeveragedSnapshot\(\)/);
  assert.doesNotMatch(route, /readMany|fetchQuotes|missing/);
  assert.doesNotMatch(route, /getMembership|auth\(\)|isPro/, "FREE: nobody is turned away, the owner included");
  assert.match(read("tests/api-access-guard.test.mjs"), /'research\/market\/leveraged':/);
  const warm = read("app/api/research/compare/warm/route.ts");
  assert.ok(warm.indexOf("await refreshLeveragedSnapshot()") < warm.indexOf("await warmMinute(Date.now(), lev.spent + board.spent"), "the snapshot first, the comparison yields its credits");
  assert.match(read("lib/research/comparison-warm.ts"), /if \(used !== null\) used \+= alreadySpent;/);
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

test("the type switcher (owner, Nov 25): 3 × 2 underline tabs with a line icon beside each word, no box, mint glow on the chosen one, one line each", () => {
  const board = read("app/research/price/market-board.tsx");
  const order = ['{ id: "fx", ja: "為替"', '{ id: "crypto", ja: "暗号資産"', '{ id: "metal", ja: "金属"', '{ id: "bond", ja: "債券ETF"', '{ id: "semi", ja: "半導体ETF"', 'const LEVERAGED = { id: "lev", ja: "レバETF"'].map(text => board.indexOf(text));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), "row 1 為替・暗号資産・金属, row 2 債券ETF・半導体ETF・レバETF");
  for (const id of ["fx", "crypto", "metal", "bond", "semi", "lev"]) assert.match(board, new RegExp(`\\n  ${id}: <`), `${id} icon`);
  assert.match(board, /fill="none" stroke="currentColor"/, "line icons in the word's colour");
  assert.match(board, /<TabIcon id=\{item\.id\} \/><span data-tab-label>/);
  assert.match(board, /while \(over\(\) && size > 9\.5\)/, "English words shrink to fit instead of being cut");
  const css = read("app/research/price/board.module.css");
  const tabs = css.slice(css.indexOf(".tabs{"), css.indexOf(".items{"));
  assert.match(tabs, /\.tabs\{[^}]*display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(tabs, /overflow-x:auto|border-radius:999px|border:1px solid/, "no scroll strip, no pill, no frame");
  assert.match(tabs, /\.tabs button\{[^}]*justify-content:center;[^}]*border:0;background:transparent;[^}]*white-space:nowrap/);
  assert.match(tabs, /\.tabs button::after\{[^}]*height:1\.5px;[^}]*background:#273140/, "a thin dark-grey underline");
  assert.match(tabs, /\.tabs button\[aria-pressed="true"\]::after\{height:3px;background:#7fe3c0;box-shadow:/, "a thicker glowing mint underline");
  assert.match(tabs, /\.tabs button\[aria-pressed="true"\] \.tabIcon\{color:#7fe3c0;filter:drop-shadow/);
  assert.doesNotMatch(tabs, /ellipsis|#d9b46a/);
});

test("レバETF never stays on 「読み込み中…」: the whole list in one answer, kept on a failed read; 「データを取得できませんでした」 only when nothing comes", () => {
  const row = (etf, percentChange = 1) => ({ ...LEVERAGED_ETFS.find(item => item.etf === etf), price: 10, percentChange, volume: 1, underlyingChange: null, extended: null });
  let view = nextLeveragedView(LEVERAGED_START, { rows: [row("MUU"), row("SOXL")], at: 5 });
  assert.deepEqual([view.rows.map(r => r.etf), view.at], [["MUU", "SOXL"], 5]);
  assert.equal(nextLeveragedView(view, null), view, "a failed read keeps the list");
  let empty = LEVERAGED_START;
  for (let i = 1; i < LEVERAGED_GIVE_UP; i++) { empty = nextLeveragedView(empty, null); assert.equal(empty.rows, null); }
  empty = nextLeveragedView(empty, null);
  assert.deepEqual([empty.rows, empty.failed], [[], true]);
  assert.equal(nextLeveragedView(empty, null).failed, true, "no flicker back to loading");
  assert.deepEqual(nextLeveragedView(empty, { rows: [row("TQQQ")], at: 1 }).rows.map(r => r.etf), ["TQQQ"], "a later answer still shows");
  assert.equal(nextLeveragedView(LEVERAGED_START, { rows: [], at: null }).failed, true, "an answer with no fund: the failure words at once");
  assert.equal(leveragedAsOf(Date.parse("2026-11-25T10:12:00Z"), true), "11/25 19:12 JST 時点");
  assert.equal(leveragedAsOf(Date.parse("2026-11-25T10:12:00Z"), false), "As of 11/25 05:12 ET");
  const list = read("app/research/price/leveraged-list.tsx");
  assert.match(list, /setTimeout\(\(\) => own\.abort\(\), READ_TIMEOUT_MS\)/, "a read never waits forever");
  assert.match(list, /READ_TIMEOUT_MS = 15_000/);
  assert.match(list, /if \(answer === null && quick < QUICK_TRIES\)/, "a failed read is asked again soon");
  assert.match(list, /now - state\.at > LEVERAGED_STALE_MS \? leveragedAsOf\(state\.at, ja\)/, "an old snapshot: the whole list with its time");
  assert.match(list, /t\("データを取得できませんでした", "Data could not be loaded"\)/);
});

test("the refresh plan: never-read symbols at once, then the oldest due ones, at most 48 a minute; ~2 minutes while trading, 15 when closed", () => {
  const all = Object.fromEntries(LEVERAGED_SYMBOLS.map(symbol => [symbol, undefined]));
  assert.deepEqual(leveragedDue(all, true), [...LEVERAGED_SYMBOLS], "the first fill is the whole list");
  const ages = Object.fromEntries(LEVERAGED_SYMBOLS.map((symbol, i) => [symbol, 60_000 + i * 1_000]));
  const due = leveragedDue(ages, true);
  assert.equal(due.length, LEVERAGED_PER_RUN);
  assert.equal(due[0], LEVERAGED_SYMBOLS.at(-1), "oldest first");
  assert.ok(due.every(symbol => ages[symbol] >= 90_000));
  assert.deepEqual(leveragedDue(ages, false), [], "closed: nothing under 15 minutes old");
  const credits = leveragedCreditsPerDay();
  assert.equal(LEVERAGED_SYMBOLS.length, 89);
  assert.deepEqual(credits, { weekday: 89 * 512, weekend: 89 * 96, perTradingMinute: 44.5, peakMinute: 48 });
  assert.deepEqual(LEVERAGED_SYMBOLS.slice(0, LEVERAGED_ETFS.length), LEVERAGED_ETFS.map(item => item.etf), "the funds first");
});

test("the snapshot written once a minute is found by every instance: the newest copy, never one more than about two minutes behind", async () => {
  const { createReader } = await import("../lib/research/twelve-budget.ts");
  const slots = new Map();
  const store = { peek: async (name, key, slot) => slots.get(`${name}|${key}|${slot}`) ?? null, put: async (name, key, slot, entry) => { const k = `${name}|${key}|${slot}`; if (!slots.has(k)) slots.set(k, entry); } };
  let t = Date.parse("2026-11-25T14:00:00Z");
  const writer = createReader(store, () => t);
  const spec = { name: "md-lev-snap-v1", slotMs: 60_000, staleMs: 3 * 86_400_000 };
  for (let minute = 0; minute < 30; minute++) {
    t = Date.parse("2026-11-25T14:00:00Z") + minute * 60_000 + 3_000 + (minute % 3) * 1_500; // the monitor's call lands a few seconds into the minute
    await writer.save(spec, "all", { value: { at: t }, at: t });
    for (const offset of [5_000, 20_000, 45_000, 58_000]) {
      const at = t + offset, reader = createReader(store, () => at); // a fresh instance: nothing in memory
      const got = await reader.read(spec, "all", null);
      assert.ok(got && at - got.value.at <= 125_000, `minute ${minute} +${offset}: ${got && (at - got.value.at)}`);
    }
  }
});
