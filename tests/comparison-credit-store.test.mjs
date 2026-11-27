import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { COST, PLAN_CREDITS_PER_MINUTE, WARM_CEILING, BACKGROUND_CEILING, USER_SERIES_CEILING, MINUTES_PER_DAY, dailyCost, hasRoom, tickersForMinute, warmUniverse, statementOrder, retryTickers } from "../lib/research/twelve-warm-plan.ts";
import { extractFinancials } from "../lib/research/comparison.ts";
import { buildSecMarketEvidence, lastClose } from "../lib/research/sec-market-evidence.ts";
import { comparisonScores } from "../lib/research/comparison-scorecard.ts";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const here = name => new URL(`../lib/research/${name}`, import.meta.url).href;

// ---------- the plan ----------
test("every listed company has one minute a day; no minute costs more than the job's share of the plan", () => {
  const rows = [];
  // About 5,540 companies the comparison offers (Nov 25: funds, preferreds, notes and ETNs are left out of the job, comparison-server.ts).
  for (let i = 0; i < 5538; i++) rows.push({ ticker: `T${i}`, cik: i, exchange: i % 2 ? "NYSE" : "Nasdaq" });
  rows.push({ ticker: "OTCX", cik: 99999, exchange: "OTC" }, { ticker: "T1-PA", cik: 1, exchange: "NYSE" }, { ticker: "ABCDW", cik: 2, exchange: "Nasdaq" }, { ticker: "GOOG", cik: 3, exchange: "Nasdaq" });
  const universe = warmUniverse(rows, ["T5", "ASML"]);
  assert.ok(!universe.includes("OTCX") && !universe.includes("T1-PA") && !universe.includes("ABCDW"));
  assert.ok(universe.includes("GOOG") && universe.includes("ASML")); // another share class is kept; extra tickers are added once
  const seen = new Map();
  for (let m = 0; m < MINUTES_PER_DAY; m++) for (const { ticker } of tickersForMinute(universe, Date.UTC(2026, 10, 15) + m * 60_000)) seen.set(ticker, (seen.get(ticker) ?? 0) + 1);
  assert.equal(seen.size, universe.length); assert.ok([...seen.values()].every(n => n === 1));
  const cost = dailyCost(universe.length, 0.3);
  assert.equal(cost.perMinute, 4); assert.equal(cost.regularPerMinute, 204);
  // Four companies and one company's statements fit under the warm tier, which leaves members at least 60 below their own ceiling (480).
  assert.ok(cost.regularPerMinute + COST.statements <= WARM_CEILING && WARM_CEILING + 60 <= USER_SERIES_CEILING && WARM_CEILING + 150 <= PLAN_CREDITS_PER_MINUTE);
  assert.ok(cost.averagePerMinute <= 300, `average ${cost.averagePerMinute}`);
  assert.ok(USER_SERIES_CEILING < PLAN_CREDITS_PER_MINUTE && BACKGROUND_CEILING < WARM_CEILING);
  assert.equal(hasRoom(null, 50, WARM_CEILING), false); assert.equal(hasRoom(null, 1, USER_SERIES_CEILING, true), true);
  assert.equal(hasRoom(370, 50, WARM_CEILING), true); assert.equal(hasRoom(371, 50, WARM_CEILING), false);
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
/** `kept`: the monitor's durable copies (lib/research/twelve-copies.ts), kind|key -> { at, value }; omitted: no monitor (every read misses). */
async function loadStore(kept = null) {
  const cache = new Map(), afterJobs = [];
  globalThis.__store = {
    durableGet: async (kind, keys) => Object.fromEntries(keys.flatMap(k => kept?.has(`${kind}|${k}`) ? [[k, structuredClone(kept.get(`${kind}|${k}`))]] : [])),
    durablePut: async (kind, key, entry) => { if (!kept) return false; kept.set(`${kind}|${key}`, structuredClone(entry)); return true; },
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
    .replace(/import \{ durableGet, durablePut \}[^;]*;/, "const { durableGet, durablePut } = globalThis.__store;")
    .replace(/import type \{ Tier \}[^;]*;/, "");
  const mod = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(text)).toString("base64") + `#${Math.random()}`);
  return { mod, cache, afterJobs };
}
const realNow = Date.now;
const withClock = async (start, fn) => { let t = start; const clock = { now: () => t, advance: ms => { t += ms; } }; Date.now = () => t; process.env.TWELVE_DATA_API_KEY = "test"; try { return await fn(clock); } finally { Date.now = realNow; delete process.env.TWELVE_DATA_API_KEY; } };

/** What one user's comparison asks of the store for one company (collector + comparison server): statements, statistics, series. */
async function userReads(mod, ticker) {
  await mod.cachedStatements(ticker); await mod.cachedStatistics(ticker); await mod.userSeries(ticker);
  if (mod.releaseStatements) await mod.releaseStatements(ticker, "2026-11-10");
}

test("a user's comparison never calls the provider: 1 user or 1,000 users comparing never-seen companies send zero calls (owner, Nov 26)", () => withClock(NOW, async clock => {
  const p = provider(clock);
  const { mod, afterJobs } = await loadStore();
  await userReads(mod, "AAOI");
  assert.deepEqual(p.calls, []); assert.equal(afterJobs.length, 0);
  for (let user = 0; user < 1000; user++) await Promise.all([0, 1, 2].map(k => userReads(mod, `RARE${(user * 3 + k) % 50}`)));
  assert.deepEqual(p.calls, []); assert.equal(p.used, 0); assert.equal(afterJobs.length, 0);
  assert.equal(mod.scheduleFill, undefined); assert.equal(mod.backgroundFill, undefined);
}));

test("what the job stored is read by every user from the shared copy", () => withClock(NOW, async clock => {
  const p = provider(clock);
  const { mod } = await loadStore();
  await mod.warmStatistics("AAOI", clock.now()); await mod.warmSeries("AAOI", clock.now()); await mod.warmStatements("AAOI", clock.now());
  p.calls.length = 0; clock.advance(5 * 60_000);
  for (let user = 0; user < 50; user++) await userReads(mod, "AAOI");
  assert.deepEqual(p.calls, []);
  assert.ok(await mod.cachedStatistics("AAOI") && await mod.cachedStatements("AAOI") && await mod.userSeries("AAOI"));
}));

test("statistics whose daily refresh was skipped stay in use for seven days, then are dropped (no flicker of financial strength)", () => withClock(realNow(), async clock => {
  // The store stamps each read with new Date() (the real clock), so this test starts at the real time.
  provider(clock);
  const { mod } = await loadStore();
  await mod.warmStatistics("MU", clock.now());
  clock.advance(2 * 86_400_000); assert.ok(await mod.cachedStatistics("MU"), "two days without a refresh: the last good copy");
  clock.advance(4.9 * 86_400_000); assert.ok(await mod.cachedStatistics("MU"), "6.9 days");
  clock.advance(0.2 * 86_400_000); assert.equal(await mod.cachedStatistics("MU"), null, "past seven days: no data");
}));

test("statements after a release are read by the job in their own slot, at most twice per company and release", () => withClock(NOW, async clock => {
  const p = provider(clock);
  const { mod } = await loadStore();
  await mod.warmStatements("NVDA", clock.now()); // this week's copy, read before the release
  assert.equal(await mod.releaseStatements("NVDA", "2026-11-10"), null);
  await mod.warmReleaseStatements("NVDA", "2026-11-10", 0);
  assert.equal((await mod.releaseStatements("NVDA", "2026-11-10")).attempt, 0);
  await mod.warmReleaseStatements("NVDA", "2026-11-10", 1);
  assert.equal((await mod.releaseStatements("NVDA", "2026-11-10")).attempt, 1);
  assert.equal(p.calls.filter(c => c.startsWith("income_statement:NVDA")).length, 3);
  assert.equal(mod.RELEASE_ATTEMPTS, 2);
}));

test("no series is fetched for a user, the background copy from yesterday is used, and nothing waits", () => withClock(NOW, async clock => {
  const p = provider(clock);
  const { mod } = await loadStore();
  await mod.warmSeries("NVDA", clock.now() - 86_400_000); // the daily job's copy from yesterday
  p.calls.length = 0; p.site = 600; clock.advance(60_000);
  const series = await mod.userSeries("NVDA");
  assert.ok(series); assert.deepEqual(p.calls, []);
}));

// Production, Nov 26: the runtime cache lost these copies within hours (ASML and AVNT stored at 00:21 UTC, UNFI at 03:30, all missing by 08:05).
test("a statistics copy the runtime cache has lost is read back from the monitor and not bought again the same day", () => withClock(NOW, async clock => {
  const state = provider(clock), kept = new Map();
  const { mod, cache } = await loadStore(kept);
  await mod.warmStatistics("ASML", clock.now());
  assert.equal(state.calls.filter(c => c === "statistics:ASML").length, 1);
  assert.ok(kept.has("compare-statistics|ASML"), "the monitor keeps the copy");
  clock.advance(7 * 3600_000);
  cache.clear(); // the runtime cache has lost it
  const got = await mod.cachedStatistics("ASML");
  assert.deepEqual(got.payload.statistics, { valuations_metrics: { forward_pe: "20" } });
  assert.equal(await mod.hasStatisticsToday("ASML", Date.parse(got.retrievedAt)), true, "a kept copy from today counts as today's");
  assert.equal(await mod.hasStatisticsToday("ASML", Date.parse(got.retrievedAt) + 86_400_000), false);
  assert.equal(state.calls.filter(c => c === "statistics:ASML").length, 1);
}));

// Production, Nov 27: BRK-B against ORCL served in kix1 showed 「株価 —」; the job had stored BRK-B's series in sfo1 (a regional runtime cache).
test("a price series the runtime cache does not hold (another region) is read back from the monitor; no provider call for the user", () => withClock(realNow(), async clock => {
  const state = provider(clock), kept = new Map();
  const { mod, cache } = await loadStore(kept);
  await mod.warmSeries("BRK-B", clock.now());
  assert.ok(kept.has("compare-series|BRK-B"), "the monitor keeps the series");
  assert.ok(state.calls.some(c => c.startsWith("time_series:BRK.B")), "asked under the provider's symbol");
  cache.clear(); state.calls.length = 0; clock.advance(10 * 3600_000);
  const got = await mod.userSeries("BRK-B");
  assert.ok(got && got.adjust === "splits"); assert.deepEqual(state.calls, []);
  assert.equal(await mod.hasSeriesToday("BRK-B", Date.parse(got.retrievedAt)), true, "a kept copy from today is not bought again");
  clock.advance(3.1 * 86_400_000); cache.clear();
  assert.equal(await mod.userSeries("BRK-B"), null, "older than three days: no copy");
}));

test("the statements (200 credits) a runtime cache has lost are read back from the monitor; the job does not buy them again", () => withClock(NOW, async clock => {
  const state = provider(clock), kept = new Map();
  const { mod, cache } = await loadStore(kept);
  await mod.warmStatements("ASML", clock.now());
  const bought = state.calls.filter(c => c.endsWith(":ASML")).length;
  assert.ok(kept.has("compare-statements|ASML"));
  clock.advance(5 * 86400_000);
  cache.clear();
  const got = await mod.cachedStatements("ASML");
  assert.ok(got, "read back from the monitor");
  assert.deepEqual(got.income, { status: "ok", meta: { symbol: "ASML", currency: "USD" }, income_statement: [] });
  assert.equal(state.calls.filter(c => c.endsWith(":ASML")).length, bought, "no new provider call");
}));

// ---------- the background job ----------
async function loadWarm(clock, { directory, needs, pending }) {
  const { mod, cache } = await loadStore();
  globalThis.__warm = { store: mod, comparisonDirectory: async () => directory, prewarmComparison: async t => { (globalThis.__prewarmed ??= []).push(t); return true; }, statementsNeeded: async t => ({ needs: needs(t), checkedAt: new Date(clock.now()).toISOString() }), pendingRelease: async t => pending?.(t) ?? null };
  const text = readFileSync(new URL("../lib/research/comparison-warm.ts", import.meta.url), "utf8")
    .replace('import "server-only";', "")
    .replace(/import providers from[^;]*;/, "const providers = [];")
    .replace(/import \{ comparisonDirectory, pendingRelease, prewarmComparison, statementsNeeded \}[^;]*;/, "const { comparisonDirectory, pendingRelease, prewarmComparison, statementsNeeded } = globalThis.__warm;")
    .replace(/import \{ RELEASE_ATTEMPTS, cachedStatements,[^;]*;/, "const { RELEASE_ATTEMPTS, cachedStatements, hasSeriesToday, hasStatisticsToday, minuteUsage, providerConfigured, releaseStatements, warmReleaseStatements, warmSeries, warmStatements, warmStatistics, weeklyNote } = globalThis.__warm.store;")
    .replace('"./twelve-warm-plan"', JSON.stringify(here("twelve-warm-plan.ts")));
  return { warm: await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(text)).toString("base64") + `#${Math.random()}`), store: mod, cache };
}

test("one minute of the job: four companies' statistics and series, statements only where the filing falls short, under the ceiling", () => withClock(Date.UTC(2026, 10, 15, 0, 0, 30), async clock => {
  const p = provider(clock); p.site = 2;
  const directory = Array.from({ length: 5541 }, (_, i) => ({ ticker: `C${i}`, cik: i, exchange: "NYSE" }));
  const { warm } = await loadWarm(clock, { directory, needs: t => t === "C1440" || t === "C2880" });
  const report = await warm.warmMinute(clock.now());
  assert.deepEqual(report.tickers, ["C0", "C1440", "C2880", "C4320"]);
  // The same four companies' SEC figures are read into the comparison cache (no provider credits).
  assert.equal(report.filings, 4); assert.deepEqual(globalThis.__prewarmed.slice(0, 4), report.tickers); delete globalThis.__prewarmed;
  assert.equal(p.calls.filter(c => c.startsWith("statistics:")).length, 4);
  assert.equal(p.calls.filter(c => c.startsWith("time_series:")).length, 4);
  // 204 + one company's statements (200) fits under 420; the second company's statements wait for its minute tomorrow, when the order has
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
  assert.equal(p.calls.filter(c => c.startsWith("statistics:")).length, 2); // 301 + 2 × 50 + series under 420; the others wait for tomorrow
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
  // Valuation no longer comes from this price-to-sales (owner, Nov 26): it is Treasure Hunt's figure, the company against its own history.
  const x = { ...mu, twelveData: evidence };
  assert.equal(comparisonScores(x, NOW).find(s => s.id === "valuation").value, null);
  assert.equal(comparisonScores({ ...x, valueCheck: { score: 20, exact: 20, pe: 20, ps: 20, peNow: 10, psNow: 3, basis: "pe-ps", period: null, asOf: "2026-11-12" } }, NOW).find(s => s.id === "valuation").value, 7);
  // A foreign filer's shares are not the listed ADS: no price-to-sales from the filing.
  const ifrs = { ...mu, quarterRevenue: { ...mu.quarterRevenue, basis: "ifrs-full" } };
  assert.equal(buildSecMarketEvidence(ifrs, series, undefined, NOW).statistics, null);
});

test("a company whose statistics were skipped in a full minute is tried first in the next minute with room, never from yesterday's minutes", () => withClock(Date.UTC(2026, 10, 15, 0, 5, 10), async clock => {
  const p = provider(clock); p.site = 300;
  const directory = Array.from({ length: 5600 }, (_, i) => ({ ticker: `C${i}`, cik: i, exchange: "NYSE" }));
  const { warm } = await loadWarm(clock, { directory, needs: () => false });
  const busy = await warm.warmMinute(clock.now());
  const skipped = busy.skipped.filter(s => s.endsWith(":statistics")).map(s => s.split(":")[0]);
  assert.ok(skipped.length > 0);
  clock.advance(60_000); p.site = 2; p.calls.length = 0;
  const next = await warm.warmMinute(clock.now());
  const statistics = p.calls.filter(c => c.startsWith("statistics:")).map(c => c.split(":")[1]);
  assert.deepEqual(statistics.slice(0, skipped.length), skipped, "the skipped companies come first");
  for (const t of next.tickers) assert.ok(statistics.includes(t), `this minute's ${t} too`);
  assert.ok(p.peak <= WARM_CEILING, `peak ${p.peak}`);
  assert.deepEqual(retryTickers(warmUniverse(directory), Date.UTC(2026, 10, 15, 0, 0, 30)), [], "minute 0 of a day looks at no minute of yesterday");
  assert.equal(retryTickers(warmUniverse(directory), Date.UTC(2026, 10, 15, 0, 3, 30)).length, 3 * 4);
}));

test("after an earnings release without its quarterly report, the job reads the statements once a day after the release, and once more only if the quarter was still missing", () => withClock(Date.UTC(2026, 10, 18, 0, 0, 30), async clock => {
  const p = provider(clock);
  const directory = [{ ticker: "NVDA", cik: 1045810, exchange: "Nasdaq" }];
  const release = { day: "2026-11-17", filedEnd: "2026-07-26" };
  const { warm, store } = await loadWarm(clock, { directory, needs: () => false, pending: t => t === "NVDA" ? release : null });
  // The rule itself.
  const at = days => Date.parse("2026-11-17") + days * 86_400_000;
  assert.equal(warm.releaseAttempt(release, null, at(0.5)), null, "not on the release day");
  assert.equal(warm.releaseAttempt(release, null, at(1)), 0);
  assert.equal(warm.releaseAttempt(release, { attempt: 0, retrievedAt: new Date(at(1)).toISOString(), newest: "2026-10-25" }, at(5)), null, "the new quarter is in");
  assert.equal(warm.releaseAttempt(release, { attempt: 0, retrievedAt: new Date(at(1)).toISOString(), newest: "2026-07-26" }, at(3)), null, "too soon to retry");
  assert.equal(warm.releaseAttempt(release, { attempt: 0, retrievedAt: new Date(at(1)).toISOString(), newest: "2026-07-26" }, at(5)), 1);
  assert.equal(warm.releaseAttempt(release, { attempt: 1, retrievedAt: new Date(at(5)).toISOString(), newest: "2026-07-26" }, at(10)), null, "at most two");
  assert.equal(warm.releaseAttempt(release, null, at(31)), null, "a month later: no more");
  assert.equal(warm.newestQuarter({ income_statement: [{ fiscal_date: "2026-07-26" }, { fiscal_date: "2026-10-25" }] }), "2026-10-25");
  // The job: NVDA's minute (index 0, minute 0 of the day) reads the statements after the release once; a second run the same day reads nothing.
  await warm.warmMinute(clock.now());
  assert.equal(p.calls.filter(c => c === "income_statement:NVDA").length, 1);
  assert.ok(await store.releaseStatements("NVDA", "2026-11-17"));
  p.calls.length = 0;
  await warm.warmMinute(clock.now());
  assert.equal(p.calls.filter(c => c.startsWith("income_statement:")).length, 0);
}));
