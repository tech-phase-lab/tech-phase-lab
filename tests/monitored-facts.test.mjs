// Production, Nov 26: on techphase.app the quote cards of ARM, TSM, ASML, ANET, CRDO, CRWV, GEV and PLTR (監視22銘柄) showed — for EPS, market
// cap and dividend yield (/api/research/market/facts answered complete:false). Twelve Data /statistics has every figure for them (ADRs
// included). The comparison's daily copy was gone hours after the job stored it, each card then asked 50 + 20 credits on the member tier, the
// 22 cards together were refused, and every refusal raised the allocator's member reserve to 480 for five minutes, refusing the warm job too.
// The minute job now keeps these cards' facts on the warm tier; members read copies only. market-data.ts is server-only, so its wiring is read
// from source; the parts it is built from are run directly.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createReader, createAllocatorModel, CEILING } from "../lib/research/twelve-budget.ts";
import { hasStatFacts, parseStatistics } from "../lib/research/market-quote.ts";
import { MONITORED_EARNINGS_PER_MINUTE, MONITORED_FACTS_TICKERS, MONITORED_STATS_PER_MINUTE, factsDue, isMonitoredFactsTicker } from "../lib/research/monitored-facts.ts";
import { T0, clockAt, memoryStore } from "./support/twelve-load-sim.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const GAPS = ["ARM", "TSM", "ASML", "ANET", "CRDO", "CRWV", "GEV", "PLTR"];
const STATS_SPEC = { name: "md-facts-stats-v2", slotMs: 6 * 3600_000, staleMs: 14 * 86_400_000 };

// Shapes of the provider's /statistics answers on Nov 26 (only the fields the card reads).
const answer = (symbol, cap, eps, forward, trailing) => ({ meta: { symbol, exchange: "NYSE" }, statistics: {
  valuations_metrics: { market_capitalization: cap }, financials: { income_statement: { diluted_eps_ttm: eps } },
  dividends_and_splits: { forward_annual_dividend_yield: forward, trailing_annual_dividend_yield: trailing } } });
const TSM = answer("TSM", 1775537164765, 15.43, 0.012935643222754697, 0.011255879254126884);
const PLTR = answer("PLTR", 394169691771, 1.42, 0, 0);
const NO_DIVIDEND = answer("CRWV", 4.5e10, -1.2, null, null);

test("the roster: the 22 monitored stocks, the eight that showed — among them", () => {
  assert.equal(MONITORED_FACTS_TICKERS.length, 22);
  for (const t of GAPS) assert.ok(isMonitoredFactsTicker(t), t);
  for (const t of ["MU", "NVDA", "AMD", "MSFT", "GOOGL"]) assert.ok(isMonitoredFactsTicker(t), t);
  assert.equal(isMonitoredFactsTicker("SONO"), false, "any other stock page keeps its own shared read");
});

test("the provider's answers for the ADRs and the non-payers parse into the card's figures; no dividend is 0.00% or —, as the card already shows", () => {
  const tsm = parseStatistics(TSM, "TSM");
  assert.equal(hasStatFacts(tsm), true);
  assert.equal(tsm.eps, 15.43);
  assert.equal(tsm.marketCap, 1775537164765);
  assert.ok(Math.abs(tsm.dividendYield - 1.2935643222754697) < 1e-9);
  const pltr = parseStatistics(PLTR, "PLTR");
  assert.equal(pltr.dividendYield, 0);
  assert.equal(hasStatFacts(pltr), true);
  const crwv = parseStatistics(NO_DIVIDEND, "CRWV");
  assert.equal(crwv.dividendYield, null);
  assert.equal(hasStatFacts(crwv), true, "a company without a dividend still has a complete answer");
  const card = read("app/research/price/quote-card.tsx");
  assert.match(card, /facts\?\.dividendYield == null \? "—" : `\$\{facts\.dividendYield\.toFixed\(2\)\}%`/);
});

test("due: never-read companies first in roster order, then the oldest copies; current copies and recently failed ones are skipped", () => {
  const states = [
    ["MU", { at: T0 - 1_000, fresh: true }], ["ARM", null], ["TSM", { at: T0 - 9 * 3600_000, fresh: false }],
    ["ASML", null], ["ANET", { at: T0 - 20 * 3600_000, fresh: false }], ["GEV", null],
  ];
  assert.deepEqual(factsDue(states, 10), ["ARM", "ASML", "GEV", "ANET", "TSM"]);
  assert.deepEqual(factsDue(states, 1), ["ARM"]);
  assert.deepEqual(factsDue(states, 2, t => t === "ARM"), ["ASML", "GEV"]);
  assert.deepEqual(factsDue(states, 0), []);
  assert.deepEqual(factsDue([["MU", { at: T0, fresh: true }]], 5), []);
});

test("the minute job fills a whole roster without copies on the warm tier within 22 minutes, and a member's read then has every card", async () => {
  const clock = clockAt(T0), store = memoryStore();
  let meter = 0, provider = 0;
  const allocator = createAllocatorModel({ readMeter: () => meter, now: clock.now });
  const job = createReader(store, clock.now), member = createReader(store, clock.now);
  // Members' cards read copies only: nothing yet.
  for (const t of MONITORED_FACTS_TICKERS) assert.equal(await member.read(STATS_SPEC, t, null), null);
  const minutes = [];
  for (let minute = 0; minute < 30; minute++) {
    meter = 0; // the provider's count starts again each minute
    let spent = 0;
    const states = await Promise.all(MONITORED_FACTS_TICKERS.map(async t => { const got = await job.read(STATS_SPEC, t, null); return [t, got && { at: got.at, fresh: got.fresh }]; }));
    for (const t of factsDue(states, MONITORED_STATS_PER_MINUTE)) {
      await job.read(STATS_SPEC, t, async () => {
        if (!allocator.grant(50, "warm")) throw new Error("twelve-budget");
        meter += 50; spent += 50; provider++;
        return parseStatistics(answer(t, 1e11, 1, 0.01, 0.01), t);
      });
    }
    minutes.push(spent);
    clock.advance(60_000);
  }
  assert.ok(minutes.every(c => c <= 50 * MONITORED_STATS_PER_MINUTE), "never more than one statistics read a minute");
  assert.equal(provider, 22, "each company read once, not once per member or per visit");
  for (const t of MONITORED_FACTS_TICKERS) {
    const got = await member.read(STATS_SPEC, t, null);
    assert.ok(got && hasStatFacts(got.value), t);
  }
  assert.ok(50 * MONITORED_STATS_PER_MINUTE + 20 * MONITORED_EARNINGS_PER_MINUTE <= CEILING.warm);
});

test("a refused warm read costs nothing and leaves the company due next minute", async () => {
  const clock = clockAt(T0), store = memoryStore(), job = createReader(store, clock.now);
  const refused = await job.read(STATS_SPEC, "ASML", async () => { throw new Error("twelve-budget"); });
  assert.equal(refused, null);
  const state = await job.read(STATS_SPEC, "ASML", null);
  assert.deepEqual(factsDue([["ASML", state && { at: state.at, fresh: state.fresh }]], 1), ["ASML"]);
});

test("wiring: members never ask the provider for a monitored company's facts; the minute job does, on the warm tier, before the comparison", () => {
  const data = read("lib/research/market-data.ts");
  const facts = data.slice(data.indexOf("export async function loadMarketFacts"), data.indexOf("let monitoredRun"));
  assert.match(facts, /const scheduled = isMonitoredFactsTicker\(ticker\);/);
  assert.match(facts, /scheduled \|\| failedLately\(`\$\{name\}:\$\{ticker\}`\) \? null/, "a monitored company's request reads copies only");
  const job = data.slice(data.indexOf("export function refreshMonitoredFacts"));
  assert.match(job, /sharedReader\.read<StatFacts>\(STATS_SPEC, t, null\)/, "what is due is decided from the copies (no credit)");
  assert.match(job, /factsDue\(stats, MONITORED_STATS_PER_MINUTE/);
  assert.match(job, /factsDue\(earnings, MONITORED_EARNINGS_PER_MINUTE/);
  assert.match(job, /readStatFacts\(t, "warm", spend\)/);
  assert.match(job, /readNextEarnings\(t, today, "warm"\)/);
  assert.match(job, /if \(isBudgetError\(error\)\) \{ if \(asked\) spent -= cost; \}/, "a refusal is not counted as spent");
  // The statistics read still takes the comparison's stored copy first (no credit), and asks the provider through the allocator's tier.
  assert.match(data, /if \(stored\) return stored\.payload;\n  spend\?\.\(\);\n  return call\("statistics", \{ symbol: ticker \}, tier\);/);
  const warm = read("app/api/research/compare/warm/route.ts");
  assert.ok(warm.indexOf("await refreshMonitoredFacts()") > 0);
  assert.ok(warm.indexOf("await refreshMonitoredFacts()") < warm.indexOf("await warmMinute("));
  assert.match(warm, /warmMinute\(Date\.now\(\), lev\.spent \+ board\.spent \+ focus\.spent \+ facts\.spent\)/, "the comparison yields what the facts took");
});
