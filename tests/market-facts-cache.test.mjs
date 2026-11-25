// Production QA, Nov 25 (~14:30 JST): NVDA, AMD and TSM showed — for EPS, 時価総額, 配当利回り and 次回決算 on techphase.app while MU did not.
// The four facts were one cached answer: a refused 20-credit earnings read threw away statistics the comparison had stored for free, an
// empty or failed statistics read was cached six hours, the CDN kept the empty answer five minutes and the page asked again only after six
// hours. The facts route (lib/research/market-data.ts loadMarketFacts) is server-only, so its wiring is read from source; the parts it is
// built from are run directly.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STALE_LIMIT_MS, createReader } from "../lib/research/twelve-budget.ts";
import { hasStatFacts, parseNextEarnings, parseStatistics } from "../lib/research/market-quote.ts";
import { T0, clockAt, memoryStore } from "./support/twelve-load-sim.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const facts = () => { const s = read("lib/research/market-data.ts"); return s.slice(s.indexOf("async function statisticsFor"), s.indexOf("/** Owner, Nov 11: the index symbols")); };

const NVDA = { meta: { symbol: "NVDA" }, statistics: { valuations_metrics: { market_capitalization: 4.4e12 }, financials: { income_statement: { diluted_eps_ttm: 4.6 } }, dividends_and_splits: { forward_annual_dividend_yield: 0.0002 } } };

test("facts: an answer without any figure is not a valid one", () => {
  assert.equal(hasStatFacts(parseStatistics(NVDA, "NVDA")), true);
  assert.equal(hasStatFacts(parseStatistics({ meta: { symbol: "NVDA" }, statistics: {} }, "NVDA")), false);
  assert.equal(hasStatFacts(parseStatistics({ status: "error", code: 429 }, "NVDA")), false);
  assert.equal(hasStatFacts(null), false);
  assert.equal(hasStatFacts({ eps: null, marketCap: null, dividendYield: 0.02 }), true);
});

test("facts: the provider's plain earnings list (only past dates) is a valid 'not known yet', not an error", () => {
  // The shape Twelve Data returns for /earnings without period=next (period=next answered 404 "No earning were found").
  assert.equal(parseNextEarnings({ meta: { symbol: "AAPL" }, earnings: [{ date: "2026-11-02" }, { date: "2026-07-30" }] }, "2026-11-25"), null);
  assert.equal(parseNextEarnings({ earnings: [{ date: "2027-02-24", eps_actual: null }, { date: "2026-11-19" }] }, "2026-11-25"), "2027-02-24");
});

test("facts: statistics and the earnings date are read separately through the shared reader; empty or refused reads fall back to the last good copy", () => {
  const src = facts();
  assert.doesNotMatch(src, /unstable_cache|market-facts-v1|FactsRefused/, "no single six-hour answer that a refusal or an empty read can poison");
  assert.doesNotMatch(src, /period: "next"/, "period=next costs 20 credits for a 404");
  assert.match(src, /sharedReader\.read<StatFacts>\(STATS_SPEC, ticker/);
  assert.match(src, /sharedReader\.read<string \| null>\(EARNINGS_SPEC, ticker/);
  assert.match(src, /if \(!hasStatFacts\(parsed\)\) throw new Error\("facts-empty"\)/, "an empty answer is thrown, so the reader never stores it");
  assert.match(src, /staleMs: 14 \* 86_400_000/);
  assert.match(src, /complete: value !== null/);
  // The stored comparison copy is read first (no credit).
  assert.match(src, /cachedStatistics\(ticker\)[\s\S]*call\("statistics"/);
});

test("facts route: an incomplete answer is never cached by the CDN; the page asks again in a minute and keeps its last facts", () => {
  const route = read("app/api/research/market/facts/route.ts");
  assert.match(route, /"Cache-Control": complete \? "public, s-maxage=300, stale-while-revalidate=600" : "no-store"/);
  assert.match(route, /ok: true, complete, facts/);
  const hook = read("app/research/price/use-market.ts");
  assert.match(hook, /const factsRetry = \{ ms: 60_000, when: \(body: Record<string, unknown>\) => body\.complete === false \}/);
  assert.match(hook, /pickFacts, 6 \* 3600_000, false, undefined, factsRetry\)/);
  assert.match(hook, /if \(retry && \(picked === null \|\| retry\.when\(body\)\)\) wait = retry\.ms;/);
});

test("facts reader: a later failed or empty read shows the earlier figures instead of —", async () => {
  // The same spec as STATS_SPEC: six-hour copies, the last good one kept fourteen days.
  const spec = { name: "md-facts-stats-v2", slotMs: 6 * 3600_000, staleMs: 14 * 86_400_000 };
  assert.ok(spec.staleMs > STALE_LIMIT_MS);
  const clock = clockAt(T0), store = memoryStore();
  const readStats = raw => async () => { const parsed = parseStatistics(raw, "NVDA"); if (!hasStatFacts(parsed)) throw new Error("facts-empty"); return parsed; };
  const first = await createReader(store, clock.now).read(spec, "NVDA", readStats(NVDA));
  assert.equal(first.value.marketCap, 4.4e12);
  clock.advance(7 * 3600_000);
  const other = createReader(store, clock.now); // another instance, the next slot
  const empty = await other.read(spec, "NVDA", readStats({ meta: { symbol: "NVDA" }, statistics: {} }));
  assert.equal(empty.fresh, false);
  assert.equal(empty.value.eps, 4.6);
  const refused = await other.read(spec, "NVDA", async () => { throw new Error("twelve-budget"); });
  assert.equal(refused.value.marketCap, 4.4e12);
  // Nothing empty was stored: a good read afterwards is fresh.
  const later = await other.read(spec, "NVDA", readStats(NVDA));
  assert.equal(later.fresh, true);
});
