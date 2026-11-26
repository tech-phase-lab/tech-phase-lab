import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shortCompanyName } from "../lib/research/company-short-name.ts";
import { parseQuote, toFavoriteQuote } from "../lib/research/market-quote.ts";
import { quoteForSession } from "../lib/research/watchlist-session.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("company names are shortened, never cut with 「…」; a name that still does not fit wraps (owner, Nov 25)", () => {
  assert.equal(shortCompanyName("Alphabet / Google"), "Alphabet");
  assert.equal(shortCompanyName("Micron Technology Inc"), "Micron Technology");
  assert.equal(shortCompanyName("NVIDIA"), "NVIDIA");
  assert.match(read("app/research/watchlist/watchlist.tsx"), /<strong>\{shortCompanyName\(item\?\.name \?\? names\[ticker\] \?\? ticker\)\}<\/strong>/);
  const css = read("app/research/watchlist/watchlist.module.css");
  assert.match(css, /\.company strong \{ font-size:13px;font-weight:700;line-height:1\.15;overflow-wrap:break-word; \}/);
  for (const [path, rule] of [["app/research/watchlist/watchlist.module.css", /\.company strong \{[^}]*\}/], ["app/research/watchlist/watchlist.module.css", /\.choices small \{[^}]*\}/],
    ["app/research/capital-map/capital-map.module.css", /\.stock strong \{[^}]*\}/], ["app/research/companies/company-directory.module.css", /\.tiles span\{[^}]*\}/],
    ["app/research/portfolio/portfolio.module.css", /\.page \.card header span\{[^}]*\}/], ["app/research/portfolio/portfolio.module.css", /\.page \.rrow header span\{[^}]*\}/]])
    assert.doesNotMatch(read(path).match(rule)[0], /ellipsis/, `${path} ${rule}`);
});

test("one row 4px taller, given to the chart; the high / low figures a little larger", () => {
  assert.match(read("app/research/watchlist/watchlist.module.css"), /\.rowMain \{[^}]*height:46px;/);
  assert.match(read("app/research/watchlist/area-chart.tsx"), /const W = 84, H = 40, LEFT = 1, RIGHT = 77, TOP = 11, BOTTOM = 31;/);
  assert.match(read("app/research/watchlist/area-chart.module.css"), /\.level \{ font-size:8\.5px;/);
});

test("a row keeps its chart when one answer comes without it; the sparkline allowance is spent only on real provider reads", async () => {
  const { keepHistory } = await import("../lib/research/quote-history.ts");
  const source = read("lib/research/quote-history.ts") + read("app/research/price/use-market.ts");
  assert.match(source, /if \(!quote\.history\?\.length && before\?\.length\) out\[ticker\] = \{ \.\.\.quote, history: before \};/);
  assert.match(source, /pickQuotes, fast \? 15_000 : 60_000, keep, history \? keepHistory : undefined[,)]/);
  {
    const path = [{ at: "2026-11-24T15:00:00Z", price: 1 }, { at: "2026-11-24T15:05:00Z", price: 2 }];
    const kept = keepHistory({ NVDA: { ticker: "NVDA", price: 1, history: path } }, { NVDA: { ticker: "NVDA", price: 3 } });
    assert.equal(kept.NVDA.price, 3); assert.deepEqual(kept.NVDA.history, path);
  }
  const data = read("lib/research/market-data.ts");
  assert.match(data, /readAll\(q\.ticker, "1d", \{ slotMs: 5 \* 60_000, fetch: \(\) => allowance-- > 0 \}\)/);
  assert.match(data, /if \(typeof fetch === "function" && !fetch\(\)\) throw new Error\("no-read-allowance"\);/);
});

test("after-hours: a newer 5-minute bar is the row's price when the provider's after-hours print stands still (owner, Nov 25: GOOGL)", () => {
  const NOW = Date.parse("2026-11-25T00:50:00Z"); // 19:50 ET
  const raw = { symbol: "GOOGL", close: "279.05", change: "-3.05", percent_change: "-1.08", is_market_open: false, timestamp: 1795636800,
    extended_price: "279.23", extended_percent_change: "0.0645", extended_timestamp: Date.parse("2026-11-24T21:43:00Z") / 1000 };
  const bars = [{ at: "2026-11-24 15:55:00", open: 279, high: 279.2, low: 278.9, close: 279.05, volume: 10 }, { at: "2026-11-24 19:45:00", open: 279.4, high: 279.6, low: 279.3, close: 279.5, volume: 5 }];
  const fav = toFavoriteQuote(parseQuote(raw, "GOOGL"), bars, NOW);
  assert.equal(fav.extended.price, 279.5); assert.equal(fav.extended.session, "post"); assert.equal(fav.extended.live, true);
  const row = quoteForSession(fav, "GOOGL", "auto");
  assert.equal(row.session, "post"); assert.equal(row.price, 279.5);
  // Without bars the provider's three-hour-old print still stands for the session under way.
  assert.equal(toFavoriteQuote(parseQuote(raw, "GOOGL"), [], NOW).extended.live, true);
  // During the regular session nothing is taken from the bars.
  const open = toFavoriteQuote(parseQuote({ ...raw, is_market_open: true }, "GOOGL"), [bars[0]], Date.parse("2026-11-24T20:50:00Z"));
  assert.equal(open.extended.price, 279.23);
});
