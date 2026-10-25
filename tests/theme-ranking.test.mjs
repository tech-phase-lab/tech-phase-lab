import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THEMES, THEME_TICKERS } from "../lib/research/theme-definitions.ts";
import { periodReturn, stockReturns, rankThemes, themeRankingAccess, PERIOD_DAYS } from "../lib/research/theme-ranking.ts";

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
    .replace(/import \{ THEME_TICKERS \} from "\.\/theme-definitions\.ts";/, 'const THEME_TICKERS = [];').replace(/import \{ stockReturns[^;]*;/, "const stockReturns = x => x;");
  const { stripTypeScriptTypes } = await import("node:module");
  const { parseTimeSeries } = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64"));
  const payload = {
    AAA: { status: "ok", values: [{ datetime: "2026-10-22", close: "10" }, { datetime: "2026-10-23", close: "11" }] },
    BBB: { status: "error", code: 404 },
    CCC: { status: "ok", values: [{ datetime: "2026-10-23", close: "n/a" }] },
  };
  const out = parseTimeSeries(payload, ["AAA", "BBB", "CCC", "DDD"]);
  assert.deepEqual(out, [{ ticker: "AAA", closes: [11, 10], asOf: "2026-10-23" }]);
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
