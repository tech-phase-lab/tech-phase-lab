import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { createBatcher } from "../lib/portfolio/quote-batcher.ts";

const load = async (path, replacements) => {
  let source = readFileSync(new URL(path, import.meta.url), "utf8").replace('import "server-only";', "");
  for (const [from, to] of replacements) source = source.replace(from, to);
  return import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64"));
};
const memoryCache = `const __store = globalThis.__cacheStore ??= new Map();
const unstable_cache = (fn, keys) => async () => { const k = JSON.stringify(keys); if (!__store.has(k)) __store.set(k, await fn()); return __store.get(k); };`;
const parse = (payload, wanted) => wanted.flatMap(t => payload[t]?.status === "ok" ? [{ ticker: t, closes: payload[t].values.map(v => Number(v.close)), asOf: payload[t].values[0].datetime }] : []);

function fakeProvider(failFor = []) {
  const calls = [];
  globalThis.fetch = async url => {
    const symbols = new URL(url).searchParams.get("symbol").split(",");
    calls.push(symbols);
    if (symbols.some(s => failFor.includes(s))) return new Response("{}", { status: 500 });
    const body = Object.fromEntries(symbols.map(s => [s, s === "NOPE" ? { status: "error" } : { status: "ok", values: [{ datetime: "2026-11-12", close: s === "USD/JPY" ? "155" : "10" }] }]));
    return Response.json(symbols.length === 1 ? body[symbols[0]].status === "ok" ? body[symbols[0]] : body[symbols[0]] : body);
  };
  return calls;
}

test("batcher: keys asked together go out as one request, a missing key is null, a failed request rejects only its chunk", async () => {
  const calls = [];
  const get = createBatcher(async keys => { calls.push(keys); if (keys.includes("BAD")) throw new Error("boom"); return new Map(keys.filter(k => k !== "NONE").map(k => [k, k + "!"])); }, 2, 5);
  assert.deepEqual(await Promise.all([get("A"), get("B"), get("NONE")]), ["A!", "B!", null]);
  assert.deepEqual(calls, [["A", "B"], ["NONE"]]);
  await assert.rejects(get("BAD"), /boom/);
});

test("portfolio quotes: a different mix of holdings never re-reads a ticker another reader already loaded", async () => {
  globalThis.__cacheStore = new Map();
  process.env.TWELVE_DATA_API_KEY = "test";
  const calls = fakeProvider();
  const { loadQuotes } = await load("../lib/portfolio/quotes.ts", [
    ['import { unstable_cache } from "next/cache";', memoryCache],
    [/import \{ parseTimeSeries \}[^;]*;/, "const parseTimeSeries = globalThis.__parse;"],
    [/import \{ createBatcher \}[^;]*;/, "const createBatcher = globalThis.__createBatcher;"],
  ].map(([a, b]) => [a, b]));
  const a = await loadQuotes(["NVDA", "MU", "AVGO"]);
  assert.deepEqual(Object.keys(a.quotes).sort(), ["AVGO", "MU", "NVDA"]);
  assert.equal(a.usdJpy, 155); assert.equal(a.asOf, "2026-11-12");
  const before = calls.length;
  const b = await loadQuotes(["MU", "NVDA"]);              // a subset, other order
  const c = await loadQuotes(["NVDA", "AVGO", "MU", "TSM"]); // a superset: only TSM is new
  assert.equal(calls.length, before + 1);
  assert.deepEqual(calls.at(-1), ["TSM"]);
  assert.deepEqual(Object.keys(b.quotes).sort(), ["MU", "NVDA"]);
  assert.deepEqual(Object.keys(c.quotes).sort(), ["AVGO", "MU", "NVDA", "TSM"]);
  const fetched = calls.flat().filter(s => s !== "USD/JPY");
  assert.equal(new Set(fetched).size, fetched.length, "no ticker is fetched twice");
  assert.equal(calls.flat().filter(s => s === "USD/JPY").length, 1, "the yen rate is shared too");
});

test("portfolio quotes: unknown symbols are omitted; a failed read fails the answer and is not cached", async () => {
  globalThis.__cacheStore = new Map();
  process.env.TWELVE_DATA_API_KEY = "test";
  let calls = fakeProvider();
  const { loadQuotes } = await load("../lib/portfolio/quotes.ts", [
    ['import { unstable_cache } from "next/cache";', memoryCache],
    [/import \{ parseTimeSeries \}[^;]*;/, "const parseTimeSeries = globalThis.__parse;"],
    [/import \{ createBatcher \}[^;]*;/, "const createBatcher = globalThis.__createBatcher;"],
  ]);
  const ok = await loadQuotes(["MU", "NOPE"]);
  assert.deepEqual(Object.keys(ok.quotes), ["MU"]);
  calls = fakeProvider(["BROKE"]);
  await assert.rejects(loadQuotes(["BROKE"]));
  calls = fakeProvider();
  assert.deepEqual(Object.keys((await loadQuotes(["BROKE"])).quotes), ["BROKE"]);
});

globalThis.__createBatcher = createBatcher;
globalThis.__parse = parse;

test("watchlist weekly returns: different lists share each ticker's reading", async () => {
  globalThis.__cacheStore = new Map();
  process.env.TWELVE_DATA_API_KEY = "test";
  const calls = fakeProvider();
  const { loadReturnsFor } = await load("../lib/research/theme-prices.ts", [
    ['import { unstable_cache } from "next/cache";', memoryCache],
    [/import \{ GROUPS[^;]*;/, "const GROUPS = [], tickersOf = () => [];"],
    [/import \{ createBatcher[^;]*;/, "const createBatcher = globalThis.__createBatcher;"],
    [/import \{ stockReturns[^;]*;/, "const stockReturns = x => ({ ticker: x.ticker, returns: {} });"],
  ]);
  const a = await loadReturnsFor(["MU", "NVDA"]);
  assert.deepEqual(a.stocks.map(s => s.ticker).sort(), ["MU", "NVDA"]);
  await loadReturnsFor(["NVDA"]);
  const c = await loadReturnsFor(["NVDA", "AVGO", "MU"]);
  assert.deepEqual(c.stocks.map(s => s.ticker).sort(), ["AVGO", "MU", "NVDA"]);
  const fetched = calls.flat();
  assert.deepEqual(fetched.sort(), ["AVGO", "MU", "NVDA"]);
  assert.equal(c.asOf, "2026-11-12");
});
