import test from "node:test";
import assert from "node:assert/strict";
import { movingAverages, splitBars, parseQuote, parseQuotes, parseBars, trimBars, chartSpec, easternToIso, toFavoriteQuote, parseStatistics, parseNextEarnings, money, signedMoney, signedPercent, compact, dateJa, rangePosition, rangeChange } from "../lib/research/market-quote.ts";

const quote = { symbol: "MU", name: "Micron", exchange: "NASDAQ", currency: "USD", datetime: "2026-11-09", timestamp: 1794000000, close: "715.41", change: "-17.74", percent_change: "-2.42", previous_close: "733.15", open: "720", high: "731.80", low: "705.20", volume: "18200000", is_market_open: true, fifty_two_week: { low: "412.60", high: "784.10" } };
test("a quote keeps the provider numbers and rejects a different symbol or a bad price", () => {
  const q = parseQuote(quote, "MU");
  assert.equal(q.price, 715.41); assert.equal(q.change, -17.74); assert.equal(q.week52High, 784.1); assert.equal(q.marketOpen, true);
  assert.equal(parseQuote(quote, "SNDK"), null);
  assert.equal(parseQuote({ ...quote, close: "0" }, "MU"), null);
  assert.equal(parseQuote({ status: "error" }, "MU"), null);
});
test("multi-symbol and single-symbol answers are both read; a missing symbol is simply absent", () => {
  assert.deepEqual(Object.keys(parseQuotes({ MU: quote, SNDK: { status: "error" } }, ["MU", "SNDK"])), ["MU"]);
  assert.deepEqual(Object.keys(parseQuotes(quote, ["MU"])), ["MU"]);
});
test("bars come back oldest-first and malformed rows are dropped", () => {
  const bars = parseBars({ values: [{ datetime: "2026-11-09", open: "2", high: "3", low: "1", close: "2.5" }, { datetime: "2026-11-06", open: "1", high: "2", low: "1", close: "1.5" }, { datetime: "bad", open: "x", high: "1", low: "1", close: "1" }] });
  assert.deepEqual(bars.map(b => b.at), ["2026-11-06", "2026-11-09"]);
});
test("ranges: 1D keeps the last session, 1W the last five, YTD this year; 3Y and 5Y are weekly", () => {
  const intraday = ["2026-11-06 15:55:00", "2026-11-09 09:30:00", "2026-11-09 09:35:00"].map(at => ({ at, open: 1, high: 1, low: 1, close: 1 }));
  assert.equal(trimBars(intraday, "1d").length, 2);
  assert.equal(trimBars(intraday, "1w").length, 3);
  const year = [{ at: "2025-12-31", open: 1, high: 1, low: 1, close: 1 }, { at: "2026-01-02", open: 1, high: 1, low: 1, close: 1 }];
  assert.equal(trimBars(year, "ytd").length, 1);
  assert.equal(chartSpec("3y").interval, "1week"); assert.equal(chartSpec("5y").interval, "1week"); assert.equal(chartSpec("1d").interval, "5min"); assert.equal(chartSpec("1w").interval, "30min"); assert.equal(chartSpec("1m").interval, "1day");
});
test("New York bar times become real instants in winter and in summer", () => {
  assert.equal(easternToIso("2026-11-09 09:30:00"), "2026-11-09T14:30:00.000Z");
  assert.equal(easternToIso("2026-07-09 09:30:00"), "2026-07-09T13:30:00.000Z");
  assert.equal(easternToIso("nope"), "");
});
test("the watchlist contract: session, source and the day's history ride with the quote", () => {
  const f = toFavoriteQuote(parseQuote(quote, "MU"), [{ at: "2026-11-09 09:30:00", open: 1, high: 1, low: 1, close: 700 }, { at: "2026-11-09 09:35:00", open: 1, high: 1, low: 1, close: 701 }]);
  assert.equal(f.source, "twelve-data"); assert.equal(f.session, "regular"); assert.equal(f.history.length, 2);
  assert.equal(toFavoriteQuote({ ...parseQuote(quote, "MU"), marketOpen: false }).session, "closed");
});
test("facts: dividend yield is a fraction in, a percent out; missing values stay null", () => {
  const f = parseStatistics({ meta: { symbol: "MU" }, statistics: { valuations_metrics: { market_capitalization: 800000000000 }, financials: { income_statement: { diluted_eps_ttm: 31.4 } }, dividends_and_splits: { forward_annual_dividend_yield: 0.0006 } } }, "MU");
  assert.equal(f.eps, 31.4); assert.equal(f.marketCap, 8e11); assert.ok(Math.abs(f.dividendYield - 0.06) < 1e-9);
  assert.equal(parseStatistics({ meta: { symbol: "MU" }, statistics: {} }, "MU").eps, null);
  assert.equal(parseNextEarnings({ earnings: [{ date: "2026-09-30" }, { date: "2026-12-17" }] }, "2026-11-10"), "2026-12-17");
});
test("text formats follow the owner's design", () => {
  assert.equal(money(715.41), "715.41 USD"); assert.equal(signedMoney(-17.74), "−17.74 USD"); assert.equal(signedMoney(1.86), "+1.86 USD");
  assert.equal(signedPercent(-2.42), "−2.42%"); assert.equal(signedPercent(2.4), "+2.40%");
  assert.equal(compact(8e11), "0.80T"); assert.equal(compact(4.2e9), "4.2B"); assert.equal(compact(18.2e6), "18.2M");
  assert.equal(dateJa("2026-12-17"), "12月17日"); assert.equal(dateJa(null), "—");
  assert.equal(Math.round(rangePosition(79.2, 52.1, 131.8)), 34); assert.equal(rangePosition(1, null, 3), null);
  assert.ok(Math.abs(rangeChange([{ at: "a", open: 100, high: 1, low: 1, close: 107 }], null, "1m").percent - 7) < 1e-9);
});

test("the quote time is the last quote, not the opening bar", () => {
  const q = parseQuote({ ...quote, timestamp: 1794000000, last_quote_at: 1794023400 }, "MU");
  assert.equal(Date.parse(q.asOf), 1794023400 * 1000);
  assert.equal(Date.parse(parseQuote({ ...quote, last_quote_at: undefined }, "MU").asOf), 1794000000 * 1000);
});
test("the next earnings date is read from a period=next answer", () => {
  assert.equal(parseNextEarnings({ earnings: [{ date: "2026-12-17" }] }, "2026-11-11"), "2026-12-17");
});

test("pre-market and after-hours prices come with the quote (prepost) and are labelled by New York time", () => {
  const after = parseQuote({ ...quote, is_market_open: false, extended_price: "716.20", extended_change: "0.79", extended_percent_change: "0.11", extended_timestamp: 1794027000 }, "MU");
  assert.equal(after.extended.price, 716.2); assert.ok(Math.abs(after.extended.percentChange - 0.11) < 1e-9);
  assert.equal(after.extended.session, "post");
  const pre = parseQuote({ ...quote, extended_price: "700", extended_percent_change: "-1", extended_timestamp: 1794027000 - 18 * 3600 }, "MU");
  assert.equal(pre.extended.session, "pre");
  assert.equal(parseQuote(quote, "MU").extended, null);
  assert.equal(toFavoriteQuote(after).extended.session, "post");
  assert.equal(chartSpec("1d").interval, "5min"); assert.ok(chartSpec("1d").size >= 400);
});

test("moving averages use the bars fetched before the visible ones; the visible range keeps its own size", () => {
  const all = Array.from({ length: 120 }, (_, i) => ({ at: `2026-0${1 + Math.floor(i / 28)}-${String(1 + i % 28).padStart(2, "0")}`, open: 1, high: 1, low: 1, close: i + 1, volume: 10 }));
  const { bars, before } = splitBars(all, "1m", Date.parse("2026-11-10"));
  assert.equal(bars.length, 23); assert.equal(before.length, 74);
  const [short, mid, long] = movingAverages(before, bars, [5, 25, 75]);
  assert.equal(short[short.length - 1], (116 + 117 + 118 + 119 + 120) / 5);
  assert.ok(long.every(v => v !== null));
  assert.equal(movingAverages([], bars.slice(0, 3), [5])[0][2], null);
  assert.ok(mid[0] !== null);
});
