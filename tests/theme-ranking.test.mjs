import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THEMES, THEME_TICKERS, GROUPS, themesOf, tickersOf, isGroupId, isGroupFilter, themeById } from "../lib/research/theme-definitions.ts";
import { periodReturn, stockReturns, yearToDateReturn, rankThemes, themeRankingAccess, sampleStockReturns, PERIOD_DAYS, PERIODS } from "../lib/research/theme-ranking.ts";

const series = (ticker, last, first, days = 70) => ({ ticker, asOf: "2026-10-23", closes: Array.from({ length: days }, (_, i) => last - (last - first) * (i / (days - 1))) });

test("themes are well formed: unique ids, 3+ unique members, no unlisted names", () => {
  assert.equal(new Set(THEMES.map(theme => theme.id)).size, THEMES.length);
  for (const theme of THEMES) {
    assert.ok(theme.tickers.length >= 3, theme.id);
    assert.equal(new Set(theme.tickers).size, theme.tickers.length, theme.id);
    assert.ok(theme.tickers.every(ticker => /^[A-Z.]{1,6}$/.test(ticker)), theme.id);
    assert.ok(theme.ja && theme.en, theme.id);
  }
  assert.equal(THEME_TICKERS.length, new Set(THEME_TICKERS).size);
});

test("periodReturn is a percent change from N trading days back, and null when history is short", () => {
  const closes = [110, 105, 100, 95, 90, 100, 80];
  assert.ok(Math.abs(periodReturn(closes, 1) - (110 / 105 - 1) * 100) < 1e-9);
  assert.ok(Math.abs(periodReturn(closes, 5) - 10) < 1e-9);
  assert.equal(periodReturn(closes, 7), null);
  assert.equal(periodReturn([100, 0], 1), null);
  assert.equal(periodReturn([NaN, 100], 1), null);
});

test("stock returns cover every period the history allows", () => {
  const full = stockReturns(series("X", 120, 100, 70));
  assert.deepEqual(Object.keys(full.returns).sort(), ["1d", "1m", "1w", "3m"]);
  const short = stockReturns(series("Y", 120, 100, 10));
  assert.deepEqual(Object.keys(short.returns).sort(), ["1d", "1w"]);
  assert.equal(PERIOD_DAYS["3m"], 63);
  // Owner, Nov 10: six months and one year too; year-to-date is measured from the last close of the previous year.
  assert.deepEqual([PERIOD_DAYS["6m"], PERIOD_DAYS["1y"]], [126, 252]);
  const long = stockReturns(series("Z", 130, 100, 270));
  assert.deepEqual(Object.keys(long.returns).sort(), ["1d", "1m", "1w", "1y", "3m", "6m"]);
});

test("year-to-date return is from the last close of the previous calendar year", () => {
  const dates = ["2026-11-09", "2026-11-06", "2026-06-01", "2026-01-02", "2025-12-31", "2025-12-30"];
  const closes = [120, 118, 110, 105, 100, 99];
  assert.ok(Math.abs(yearToDateReturn(closes, dates) - 20) < 1e-9);          // 120 against the 2025-12-31 close of 100
  assert.equal(yearToDateReturn(closes.slice(0, 4), dates.slice(0, 4)), null);  // no previous-year close in the history
  assert.equal(yearToDateReturn(closes, undefined), null);
  assert.equal(yearToDateReturn(closes, dates.slice(1)), null);
  const withDates = stockReturns({ ticker: "Q", asOf: "2026-11-09", closes, dates });
  assert.ok(Math.abs(withDates.returns.ytd - 20) < 1e-9);
});

test("themes rank by the equal-weighted average, best first, with leader, laggard and coverage", () => {
  const themes = [{ id: "a", ja: "A", en: "A", tickers: ["A1", "A2", "A3"] }, { id: "b", ja: "B", en: "B", tickers: ["B1", "B2", "B3"] }, { id: "c", ja: "C", en: "C", tickers: ["C1", "C2", "C3"] }];
  const stocks = [["A1", 10], ["A2", 20], ["A3", 0], ["B1", -5], ["B2", -15], ["C1", 50]].map(([ticker, value]) => ({ ticker, returns: { "1w": value } }));
  const rows = rankThemes(stocks, "1w", themes);
  assert.deepEqual(rows.map(row => [row.id, row.rank]), [["a", 1], ["b", 2]]); // C has one priced member and is not ranked
  assert.equal(rows[0].value, 10);
  assert.deepEqual([rows[0].leader.ticker, rows[0].laggard.ticker], ["A2", "A3"]);
  assert.deepEqual([rows[0].covered, rows[0].total], [3, 3]);
  assert.deepEqual([rows[1].covered, rows[1].total], [2, 3]);
  assert.equal(rows[1].members.at(-1).value, null); // members without a number sink to the bottom
  assert.deepEqual(rankThemes(stocks, "1d", themes), []);
});

test("access is PRO only, with an open access window", () => {
  const now = 1_000;
  assert.equal(themeRankingAccess({ status: "signed-in", plan: "pro", accessExpiresAt: now + 1 }, now), 200);
  assert.equal(themeRankingAccess({ status: "signed-in", plan: "pro", accessExpiresAt: now }, now), 403);
  assert.equal(themeRankingAccess({ status: "signed-in", plan: "free" }, now), 403);
  assert.equal(themeRankingAccess({ status: "signed-out", plan: "free" }, now), 401);
  assert.equal(themeRankingAccess({ status: "unavailable", plan: "free" }, now), 503);
});

test("the Twelve Data answer is parsed per symbol, newest first, skipping bad symbols", async () => {
  const source = readFileSync(new URL("../lib/research/theme-prices.ts", import.meta.url), "utf8")
    .replace('import "server-only";', "").replace('import { unstable_cache } from "next/cache";', "const unstable_cache = fn => fn;")
    .replace(/import \{ GROUPS[^;]*;/, 'const GROUPS = [], tickersOf = () => [];').replace(/import \{ stockReturns[^;]*;/, "const stockReturns = x => x;").replace(/import \{ createBatcher[^;]*;/, "const createBatcher = () => async () => null;");
  const { stripTypeScriptTypes } = await import("node:module");
  const { parseTimeSeries } = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64"));
  const payload = {
    AAA: { status: "ok", values: [{ datetime: "2026-10-22", close: "10" }, { datetime: "2026-10-23", close: "11" }] },
    BBB: { status: "error", code: 404 },
    CCC: { status: "ok", values: [{ datetime: "2026-10-23", close: "n/a" }] },
  };
  const out = parseTimeSeries(payload, ["AAA", "BBB", "CCC", "DDD"]);
  assert.deepEqual(out, [{ ticker: "AAA", closes: [11, 10], asOf: "2026-10-23", dates: ["2026-10-23", "2026-10-22"] }]);
  assert.deepEqual(parseTimeSeries(null, ["AAA"]), []);
});

test("PRO gate and the no-invention rule are in place on the route and the screen", () => {
  const route = readFileSync(new URL("../app/api/research/themes/route.ts", import.meta.url), "utf8");
  assert.match(route, /themeRankingAccess\(member\)/);
  assert.match(route, /not-connected/);
  const screen = readFileSync(new URL("../app/research/themes/screen.tsx", import.meta.url), "utf8");
  assert.match(screen, /plan === "free"/);
  assert.doesNotMatch(screen, /Math\.random/);
});

test("the owner-only sample is deterministic, covers every theme and every period, and is never wired to the API", () => {
  const a = sampleStockReturns(THEME_TICKERS), b = sampleStockReturns(THEME_TICKERS);
  assert.deepEqual(a, b);
  assert.equal(rankThemes(a, "1w").length, THEMES.length);
  assert.deepEqual([...PERIODS], ["1d", "1w", "1m", "3m", "6m", "ytd", "1y"]);
  for (const group of GROUPS) assert.equal(rankThemes(sampleStockReturns(tickersOf(group.id)), "1w", themesOf(group.id)).length, themesOf(group.id).length, group.id);
  assert.ok(a.every(stock => PERIODS.every(period => Number.isFinite(stock.returns[period]))));
  const route = readFileSync(new URL("../app/api/research/themes/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /sample/i);
  const screen = readFileSync(new URL("../app/research/themes/screen.tsx", import.meta.url), "utf8");
  assert.match(screen, /owner &&/); // the preview button exists only for the owner
});

test("the screen says the price feed is being connected instead of an error while it is not", () => {
  const screen = readFileSync(new URL("../app/research/themes/screen.tsx", import.meta.url), "utf8");
  assert.match(screen, /state === "not-connected" && !sample/);
  assert.match(screen, /株価データの接続を準備中です/);
});

test("every genre has themes, theme ids are unique across genres, and only known genres are accepted", () => {
  assert.equal(GROUPS.length, 7);
  for (const group of GROUPS) { assert.ok(themesOf(group.id).length >= 4, group.id); assert.ok(group.ja && group.en); }
  assert.ok(THEMES.every(theme => GROUPS.some(group => group.id === theme.group)));
  assert.equal(new Set(THEMES.map(theme => theme.id)).size, THEMES.length);
  assert.equal(isGroupId("tech"), true);
  assert.equal(isGroupId("gold"), false);
  assert.equal(isGroupId(undefined), false);
  assert.equal(isGroupFilter("all"), true);   // the wheel's first item reads every genre
  assert.equal(isGroupFilter("gold"), false);
  assert.deepEqual(GROUPS.map(group => group.ja), ["ハイテク", "資源・エネルギー", "金融", "ヘルスケア・バイオ", "消費・小売", "高配当", "産業・防衛"]);
  const route = readFileSync(new URL("../app/api/research/themes/route.ts", import.meta.url), "utf8");
  assert.match(route, /isGroupFilter\(requested\)/);
});


test("the memory theme is MU, SKHY, SNDK, WDC and STX, and every theme stock has a Japanese and an English name", () => {
  assert.deepEqual(themeById("memory").tickers, ["MU", "SKHY", "SNDK", "WDC", "STX"]);
  const names = JSON.parse(readFileSync(new URL("../lib/research/theme-stock-names.json", import.meta.url), "utf8"));
  for (const ticker of THEME_TICKERS) assert.ok(names[ticker]?.ja && names[ticker]?.en, ticker);
});

test("the genre wheel, the seven periods and the single up/down chart follow the design", () => {
  const screen = readFileSync(new URL("../app/research/themes/screen.tsx", import.meta.url), "utf8");
  const parts = readFileSync(new URL("../app/research/themes/parts.tsx", import.meta.url), "utf8");
  assert.match(screen, /id: "all", ja: "すべて"/);
  assert.match(screen, /navigator\.vibrate\(8\)/);
  assert.match(screen, /\{ switch: "" \}/);
  assert.match(screen, /\{!atEnd && <span className=\{styles\.hint\}/);   // the "››" hint goes once the last item has been reached
  assert.match(parts, /"1d": ja \? "1日"/); assert.match(parts, /"3m": ja \? "3ヵ月"/); assert.match(parts, /"ytd": ja \? "年初来"/);
  assert.doesNotMatch(parts, /か月/);
  assert.match(parts, /\/ widest \* 48/);                                    // a bar is |value| / the largest |value| * 48% of the width
  assert.match(parts, /rows\.filter\(row => shown\(row\.value\) < 0\)\.length/);   // 下落 M / 上昇 N are the counts of the moment; 0% counts as rising
  assert.doesNotMatch(screen, /数値は表示サンプルです/);
});


test("genres follow what the companies are (owner, Nov 10): Oracle is AI cloud and software, crypto is finance, nuclear is resources, dividend and industrials are apart", () => {
  const inGroup = (ticker) => new Set(THEMES.filter(theme => theme.tickers.includes(ticker)).map(theme => theme.group));
  assert.ok(themeById("ai-cloud").tickers.includes("ORCL") && themeById("software").tickers.includes("ORCL"));
  assert.deepEqual([...inGroup("COIN")], ["finance"]);
  assert.deepEqual([...inGroup("CCJ")], ["resources"]);
  assert.deepEqual([...inGroup("LMT")], ["industrials"]);
  assert.deepEqual([...inGroup("O")], ["defensive"]);
  assert.equal(themeById("nuclear").ja, "原子力・ウラン");
  assert.equal(themeById("crypto").ja, "暗号資産・ブロックチェーン");
});
