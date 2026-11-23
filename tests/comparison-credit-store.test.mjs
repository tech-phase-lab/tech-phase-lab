import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { COST, PLAN_CREDITS_PER_MINUTE, WARM_CEILING, BACKGROUND_CEILING, USER_SERIES_CEILING, MINUTES_PER_DAY, dailyCost, hasRoom, tickersForMinute, warmUniverse, daySlot, statementOrder } from "../lib/research/twelve-warm-plan.ts";
import { extractFinancials } from "../lib/research/comparison.ts";
import { buildSecMarketEvidence, lastClose } from "../lib/research/sec-market-evidence.ts";
import { applyValuationBasis, comparisonScores } from "../lib/research/comparison-scorecard.ts";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const here = name => new URL(`../lib/research/${name}`, import.meta.url).href;

// ---------- the plan ----------
test("every listed company has one minute a day; no minute costs more than the job's share of the plan", () => {
  const rows = [];
  for (let i = 0; i < 6462; i++) rows.push({ ticker: `T${i}`, cik: i, exchange: i % 2 ? "NYSE" : "Nasdaq" });
  rows.push({ ticker: "OTCX", cik: 99999, exchange: "OTC" }, { ticker: "T1-PA", cik: 1, exchange: "NYSE" }, { ticker: "ABCDW", cik: 2, exchange: "Nasdaq" }, { ticker: "GOOG", cik: 3, exchange: "Nasdaq" });
  const universe = warmUniverse(rows, ["T5", "ASML"]);
  assert.ok(!universe.includes("OTCX") && !universe.includes("T1-PA") && !universe.includes("ABCDW"));
  assert.ok(universe.includes("GOOG") && universe.includes("ASML")); // another share class is kept; extra tickers are added once
  const seen = new Map();
  for (let m = 0; m < MINUTES_PER_DAY; m++) for (const { ticker } of tickersForMinute(universe, Date.UTC(2026, 10, 15) + m * 60_000)) seen.set(ticker, (seen.get(ticker) ?? 0) + 1);
  assert.equal(seen.size, universe.length); assert.ok([...seen.values()].every(n => n === 1));
  const cost = dailyCost(universe.length, 0.3);
  assert.equal(cost.perMinute, 5); assert.equal(cost.regularPerMinute, 255);
  assert.ok(cost.regularPerMinute + COST.statements <= WARM_CEILING && WARM_CEILING + 150 <= PLAN_CREDITS_PER_MINUTE);
  assert.ok(cost.averagePerMinute <= 300, `average ${cost.averagePerMinute}`);
  assert.ok(USER_SERIES_CEILING < PLAN_CREDITS_PER_MINUTE && BACKGROUND_CEILING < WARM_CEILING);
  assert.equal(hasRoom(null, 50, WARM_CEILING), false); assert.equal(hasRoom(null, 1, USER_SERIES_CEILING, true), true);
  assert.equal(hasRoom(410, 50, WARM_CEILING), true); assert.equal(hasRoom(411, 50, WARM_CEILING), false);
});

// ---------- the store, with a simulated provider and meter ----------
function provider(clock) {
  const state = { used: 0, minute: -1, calls: [], peak: 0, site: 0 };
  const roll = () => { const m = Math.floor(clock.now() / 60_000); if (m !== state.minute) { state.minute = m; state.used = state.site; } };
  const charge = n => { roll(); state.used += n; state.peak = Math.max(state.peak, state.used); };
  globalThis.fetch = async input => {
    const url = new URL(String(input)), path = url.pathname.slice(1), symbol = url.searchParams.get("symbol");
    if (path === "api_usage") { charge(1); return Response.json({ current_usage: state.used, plan_limit: 610 }); }
    const cost = { statistics: 50, income_statement: 100, cash_flow: 100, time_series: 1 }[path];
    charge(cost); state.calls.push(`${path}:${symbol}`);
    if (state.used > PLAN_CREDITS_PER_MINUTE) return Response.json({ status: "error", code: 429, message: "limit" }, { status: 429 });
    const day = new Date(clock.now()).toISOString().slice(0, 10);
    if (path === "time_series") return Response.json({ status: "ok", meta: { symbol, interval: "1day", currency: "USD" }, values: [{ datetime: "2026-11-12", close: "120" }, { datetime: "2026-08-12", close: "100" }, { datetime: day, close: "1" }] });
    return Response.json({ status: "ok", meta: { symbol, currency: "USD" }, [path === "statistics" ? "statistics" : path]: path === "statistics" ? { valuations_metrics: { forward_pe: "20" } } : [] });
  };
  return state;
}
async function loadStore() {
  const cache = new Map(), afterJobs = [];
  globalThis.__store = {
    unstable_cache: (fn, parts) => async (...args) => { const k = parts.join() + JSON.stringify(args); if (cache.has(k)) return structuredClone(cache.get(k)); const v = await fn(...args); cache.set(k, v); return v; },
    after: job => afterJobs.push(job),
  };
  const text = readFileSync(new URL("../lib/research/twelve-store.ts", import.meta.url), "utf8")
    .replace('import "server-only";', "")
    .replace(/import \{ unstable_cache \} from "next\/cache";/, "const { unstable_cache } = globalThis.__store;")
    .replace(/import \{ after \} from "next\/server";/, "const { after } = globalThis.__store;")
    .replace('"./twelve-credit-gate"', JSON.stringify(here("twelve-credit-gate.ts")))
    .replace('"./twelve-warm-plan"', JSON.stringify(here("twelve-warm-plan.ts")))
    .replace('"./provider-symbol"', JSON.stringify(here("provider-symbol.ts")))
    // The allocator grants everything here (the simulated provider refuses past the plan); the meter is the provider's own count.
    .replace(/import \{ reserveCredits, sharedMeterUsage \}[^;]*;/, `const reserveCredits = async () => {}; const sharedMeterUsage = async () => { const r = await fetch("https://api.twelvedata.com/api_usage?apikey=test"); return parseUsage(await r.json()); };`)
    .replace(/import type \{ Tier \}[^;]*;/, "");
  const mod = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(text)).toString("base64") + `#${Math.random()}`);
  return { mod, cache, afterJobs };
}
const realNow = Date.now;
const withClock = async (start, fn) => { let t = start; const clock = { now: () => t, advance: ms => { t += ms; } }; Date.now = () => t; process.env.TWELVE_DATA_API_KEY = "test"; try { return await fn(clock); } finally { Date.now = realNow; delete process.env.TWELVE_DATA_API_KEY; } };

/** What one user's comparison asks of the store for one company (collector + comparison server): statements, statistics, series. */
async function userReads(mod, ticker) {
  await mod.cachedStatements(ticker); await mod.cachedStatistics(ticker); await mod.userSeries(ticker);
  mod.scheduleFill(ticker, { statistics: true, statements: true });
}

test("cold cache: 300 users each comparing three never-seen companies in one minute never wait and never pass the plan's limit", () => withClock(NOW, async clock => {
  const p = provider(clock); p.site = 2;
  const { mod, afterJobs } = await loadStore();
  const started = Date.now();
  for (let user = 0; user < 300; user++) await Promise.all([0, 1, 2].map(k => userReads(mod, `RARE${user * 3 + k}`)));
  assert.equal(Date.now(), started); // the simulated clock never moved: nothing slept or waited for credits
  // A user's request itself sends only one-credit price series, and only while the minute is under its ceiling.
  assert.ok(p.calls.every(c => c.startsWith("time_series:")), p.calls.find(c => !c.startsWith("time_series:")));
  assert.ok(p.used <= USER_SERIES_CEILING + 3, `used ${p.used}`);
  assert.ok(p.calls.length < 900); // the rest got no series this minute (their factor waits for the next request), not an error
  // The background fills after the answers stay under their own ceiling, and nothing exceeds the plan's 610.
  for (const job of afterJobs.splice(0)) await job();
  assert.ok(p.peak <= PLAN_CREDITS_PER_MINUTE, `peak ${p.peak}`);
  assert.equal(p.calls.filter(c => !c.startsWith("time_series:")).length, 0); // the minute was already full: no 50- or 200-credit call
}));

test("a quiet minute: a never-seen company gets its series at once and its statistics in the background, once for everyone", () => withClock(NOW, async clock => {
  const p = provider(clock);
  const { mod, afterJobs } = await loadStore();
  await userReads(mod, "AAOI");
  assert.deepEqual(p.calls, ["time_series:AAOI"]);
  for (const job of afterJobs.splice(0)) await job();
  assert.deepEqual(p.calls.sort(), ["cash_flow:AAOI", "income_statement:AAOI", "statistics:AAOI", "time_series:AAOI"]);
  clock.advance(5 * 60_000); p.calls.length = 0;
  for (let user = 0; user < 50; user++) await userReads(mod, "AAOI"); // everyone after that reads the shared copy
  for (const job of afterJobs.splice(0)) await job();
  assert.deepEqual(p.calls, []);
  assert.ok(await mod.cachedStatistics("AAOI") && await mod.cachedStatements("AAOI") && await mod.userSeries("AAOI"));
}));

test("a full minute: no series is fetched for a user, the background copy from yesterday is used, and nothing waits", () => withClock(NOW, async clock => {
  const p = provider(clock);
  const { mod } = await loadStore();
  await mod.warmSeries("NVDA", clock.now() - 86_400_000); // the daily job's copy from yesterday
  p.calls.length = 0; p.site = 600; clock.advance(60_000);
  const series = await mod.userSeries("NVDA");
  assert.ok(series); assert.deepEqual(p.calls, []);
}));

test("statistics older than the factor's 36 hours are not used; the day slots keep a refreshed entry for a whole day", () => withClock(NOW, async clock => {
  provider(clock);
  const { mod } = await loadStore();
  await mod.warmStatistics("MU", clock.now());
  clock.advance(30 * 3600_000); assert.ok(await mod.cachedStatistics("MU"));
  clock.advance(10 * 3600_000); assert.equal(await mod.cachedStatistics("MU"), null);
  assert.equal(daySlot(clock.now()) - daySlot(NOW), 2);
}));

// ---------- the background job ----------
async function loadWarm(clock, { directory, needs }) {
  const { mod, cache } = await loadStore();
  globalThis.__warm = { store: mod, comparisonDirectory: async () => directory, prewarmComparison: async t => { (globalThis.__prewarmed ??= []).push(t); return true; }, statementsNeeded: async t => ({ needs: needs(t), checkedAt: new Date(clock.now()).toISOString() }) };
  const text = readFileSync(new URL("../lib/research/comparison-warm.ts", import.meta.url), "utf8")
    .replace('import "server-only";', "")
    .replace(/import providers from[^;]*;/, "const providers = [];")
    .replace(/import \{ comparisonDirectory, prewarmComparison, statementsNeeded \}[^;]*;/, "const { comparisonDirectory, prewarmComparison, statementsNeeded } = globalThis.__warm;")
    .replace(/import \{ cachedStatements,[^;]*;/, "const { cachedStatements, hasSeriesToday, hasStatisticsToday, minuteUsage, providerConfigured, warmSeries, warmStatements, warmStatistics, weeklyNote } = globalThis.__warm.store;")
    .replace('"./twelve-warm-plan"', JSON.stringify(here("twelve-warm-plan.ts")));
  return { warm: await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(text)).toString("base64") + `#${Math.random()}`), store: mod, cache };
}

test("one minute of the job: five companies' statistics and series, statements only where the filing falls short, under the ceiling", () => withClock(Date.UTC(2026, 10, 15, 0, 0, 30), async clock => {
  const p = provider(clock); p.site = 2;
  const directory = Array.from({ length: 6462 }, (_, i) => ({ ticker: `C${i}`, cik: i, exchange: "NYSE" }));
  const { warm } = await loadWarm(clock, { directory, needs: t => t === "C1440" || t === "C2880" });
  const report = await warm.warmMinute(clock.now());
  assert.deepEqual(report.tickers, ["C0", "C1440", "C2880", "C4320", "C5760"]);
  // The same five companies' SEC figures are read into the comparison cache (no provider credits).
  assert.equal(report.filings, 5); assert.deepEqual(globalThis.__prewarmed.slice(0, 5), report.tickers); delete globalThis.__prewarmed;
  assert.equal(p.calls.filter(c => c.startsWith("statistics:")).length, 5);
  assert.equal(p.calls.filter(c => c.startsWith("time_series:")).length, 5);
  // 255 + one company's statements (200) fits under 460; the second company's statements wait for its minute tomorrow, when the order has
  // turned (statementOrder), so the same company is not skipped every day.
  const [first, second] = statementOrder(report.tickers, clock.now()).filter(t => t === "C1440" || t === "C2880");
  assert.deepEqual(p.calls.filter(c => c.startsWith("income_statement:")), [`income_statement:${first}`]);
  assert.deepEqual(report.skipped, [`${second}:statements`]);
  assert.ok(p.peak <= WARM_CEILING, `peak ${p.peak}`);
  // Called again in the same minute (a retry): everything is already stored, nothing is spent.
  p.calls.length = 0;
  const again = await warm.warmMinute(clock.now());
  assert.equal(again.spent, 0); assert.ok(p.calls.every(c => c === `income_statement:${second}` || c === `cash_flow:${second}`));
}));

test("a busy site minute: the job sends nothing that would take the minute over its ceiling", () => withClock(Date.UTC(2026, 10, 15, 0, 1, 10), async clock => {
  const p = provider(clock); p.site = 300;
  const directory = Array.from({ length: 6462 }, (_, i) => ({ ticker: `C${i}`, cik: i, exchange: "NYSE" }));
  const { warm } = await loadWarm(clock, { directory, needs: () => false });
  const report = await warm.warmMinute(clock.now());
  assert.ok(p.peak <= WARM_CEILING, `peak ${p.peak}`);
  assert.equal(p.calls.filter(c => c.startsWith("statistics:")).length, 3); // 301 + 3 × 50 + series; the other two wait for tomorrow
  assert.ok(report.skipped.some(s => s.endsWith(":statistics")));
}));

// ---------- valuation without stored statistics ----------
const fixture = t => JSON.parse(readFileSync(new URL(`./fixtures/sec-companyfacts-${t}.json`, import.meta.url), "utf8"));
test("no stored statistics: price-to-sales from the filing (close × diluted shares ÷ four quarters' revenue), so every company still has a valuation", () => {
  // The trimmed fixture has no share counts; the real filing's fiscal-year diluted average (1.13 billion) stands in for the fourth quarter.
  const mu = { ...extractFinancials("MU", "723125", fixture("MU"), NOW), quarterDilutedShares: 1.13e9 };
  assert.ok(mu.quarterRevenueTtm > 0);
  const series = { adjust: "splits", retrievedAt: "2026-11-13T11:00:00Z", payload: { meta: { symbol: "MU", interval: "1day", currency: "USD" }, status: "ok", values: [{ datetime: "2026-11-13", close: "1" }, { datetime: "2026-11-12", close: "120" }, { datetime: "2026-08-12", close: "100" }] } };
  assert.equal(lastClose(series, "MU", "USD", NOW), 120); // today's unfinished bar is not used
  assert.equal(lastClose(series, "AAPL", "USD", NOW), null); assert.equal(lastClose(series, "MU", "EUR", NOW), null);
  const evidence = buildSecMarketEvidence(mu, series, undefined, NOW);
  assert.equal(evidence.statistics.forwardPE, null);
  assert.ok(Math.abs(evidence.statistics.priceToSales - 120 * mu.quarterDilutedShares / mu.quarterRevenueTtm) < 1e-9);
  const a = { ...mu, twelveData: evidence }, b = { ...mu, ticker: "MU2", twelveData: evidence };
  const [x] = applyValuationBasis([a, b], NOW);
  assert.equal(x.valuationBasis, "ps");
  assert.notEqual(comparisonScores(x, NOW).find(s => s.id === "valuation").value, null);
  // A foreign filer's shares are not the listed ADS: no price-to-sales from the filing.
  const ifrs = { ...mu, quarterRevenue: { ...mu.quarterRevenue, basis: "ifrs-full" } };
  assert.equal(buildSecMarketEvidence(ifrs, series, undefined, NOW).statistics, null);
});
