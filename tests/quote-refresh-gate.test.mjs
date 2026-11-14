import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FAST_QUOTE_TTL_MS, FAST_REFRESH_BUDGET, PLAN_CREDITS_PER_MINUTE, QUOTE_TTL_MS, creditWindow, fitsBudget, parseUsage, quotesToRead } from "../lib/research/quote-refresh-gate.ts";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the refresh intervals and the share of the plan the extra reads may use", () => {
  assert.equal(FAST_QUOTE_TTL_MS, 15_000);
  assert.equal(QUOTE_TTL_MS, 60_000);
  assert.equal(PLAN_CREDITS_PER_MINUTE, 610);
  assert.ok(FAST_REFRESH_BUDGET < PLAN_CREDITS_PER_MINUTE / 2);
});

test("without fast, only quotes older than a minute (or never read) are read", () => {
  const ages = { MU: Infinity, NVDA: 70_000, TSM: 20_000, AMD: 5_000 };
  assert.deepEqual(quotesToRead(ages, false, () => true), { read: ["MU", "NVDA"], fast: false });
});

test("fast reads the 15-60 second quotes too, only when the gate allows their cost", () => {
  const ages = { MU: Infinity, NVDA: 70_000, TSM: 20_000, SNDK: 45_000, AMD: 5_000 };
  const asked = [];
  assert.deepEqual(quotesToRead(ages, true, extra => { asked.push(extra); return true; }), { read: ["MU", "NVDA", "TSM", "SNDK"], fast: true });
  assert.deepEqual(asked, [2]);
  assert.deepEqual(quotesToRead(ages, true, () => false), { read: ["MU", "NVDA"], fast: false });
  assert.deepEqual(quotesToRead({ AMD: 5_000 }, true, () => { throw new Error("not asked"); }), { read: [], fast: true });
});

test("the budget check: room needed for the whole extra cost; an unread meter never grants it", () => {
  assert.equal(fitsBudget(150, 50), true);
  assert.equal(fitsBudget(151, 50), false);
  assert.equal(fitsBudget(null, 1), false);
  assert.equal(fitsBudget(Number.NaN, 1), false);
  assert.equal(fitsBudget(500, 10, 610), true);
});

test("the local window forgets spending older than a minute", () => {
  let now = 0;
  const window = creditWindow(() => now);
  window.record(10); now = 30_000; window.record(5);
  assert.equal(window.total(), 15);
  now = 60_001; assert.equal(window.total(), 5);
  now = 95_000; assert.equal(window.total(), 0);
});

test("usage answers are parsed strictly", () => {
  assert.equal(parseUsage({ current_usage: 42, plan_limit: 610 }), 42);
  assert.equal(parseUsage({ current_usage: "42" }), null);
  assert.equal(parseUsage(null), null);
});

test("the watchlist and a stock's page ask with fast=1 every 15 seconds; other screens keep a minute", async () => {
  const hook = await read("app/research/price/use-market.ts");
  assert.match(hook, /fast \? "&fast=1" : ""/);
  assert.match(hook, /fast \? 15_000 : 60_000/);
  assert.match(await read("app/research/watchlist/watchlist.tsx"), /useQuotes\(favorites\.slice\(0, 100\), true, true\)/);
  assert.match(await read("app/research/price/quote-detail.tsx"), /useQuotes\(\[ticker\], false, true\)/);
  const route = await read("app/api/research/market/quotes/route.ts");
  assert.match(route, /params\.get\("fast"\) === "1"/);
  assert.match(route, /"X-Quote-Refresh": granted \? "15s" : "60s"/);
  const data = await read("lib/research/market-data.ts");
  assert.match(data, /const TTL = 60_000;/); // the shared one-minute cache for everything else is unchanged
  assert.match(data, /fitsBudget\(used, extra, FAST_REFRESH_BUDGET\)/);
});
