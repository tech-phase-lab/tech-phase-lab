import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CEILING, PLAN_CREDITS_PER_MINUTE, STALE_LIMIT_MS, createGovernor, createReader, creditCost, quoteSlotMs, barSlotMs, stocksTrading } from "../lib/research/twelve-budget.ts";
import { T0, clockAt, memoryStore, simulate } from "./support/twelve-load-sim.mjs";


test("credit costs: batched quotes and series cost one credit per symbol; fundamentals cost their fixed price", () => {
  assert.equal(creditCost("quote", { symbol: "NVDA,MU,AVGO" }), 3);
  assert.equal(creditCost("time_series", { symbol: "NVDA" }), 1);
  assert.equal(creditCost("statistics", { symbol: "NVDA" }), 50);
  assert.equal(creditCost("earnings", { symbol: "NVDA" }), 20);
  assert.equal(creditCost("splits", { symbol: "NVDA" }), 20);
  assert.equal(creditCost("income_statement", { symbol: "NVDA" }), 100);
});

test("tiers: background yields first, then members' pages; price alerts keep room above both, all inside the plan", () => {
  assert.ok(CEILING.fast < CEILING.background && CEILING.background < CEILING.user && CEILING.user < CEILING.critical && CEILING.critical <= PLAN_CREDITS_PER_MINUTE);
  assert.ok(CEILING.user + 100 <= CEILING.critical); // a 100-symbol alert pass fits above a full minute of page views
  // The monitor's own ceilings follow the same order (the Python constants are read from source).
  const py = name => Number(new RegExp(`^${name} = (\\d+)`, "m").exec(readFileSync(new URL(`../scripts/research/${name === "TWELVE_MAX_USED" ? "ownership_data" : name === "OWN_PER_MINUTE" ? "value_check" : "price_alerts"}.py`, import.meta.url), "utf8"))[1]);
  assert.equal(py("CREDIT_CEILING"), CEILING.critical);
  assert.equal(py("TWELVE_MAX_USED"), CEILING.background);
  const valueCheck = Number(/^CREDIT_CEILING = (\d+)/m.exec(readFileSync(new URL("../scripts/research/value_check.py", import.meta.url), "utf8"))[1]);
  assert.ok(valueCheck <= CEILING.background);
});

test("slots: a minute while stocks trade (4:00-20:00 New York, weekdays), fifteen minutes otherwise; currencies always a minute", () => {
  assert.equal(stocksTrading(T0), true);
  assert.equal(stocksTrading(Date.parse("2026-11-22T15:00:00Z")), false); // Sunday
  assert.equal(stocksTrading(Date.parse("2026-11-24T02:00:00Z")), false); // 21:00 New York
  assert.equal(quoteSlotMs("NVDA", T0), 60_000);
  assert.equal(quoteSlotMs("NVDA", Date.parse("2026-11-22T15:00:00Z")), 15 * 60_000);
  assert.equal(quoteSlotMs("BTC/USD", Date.parse("2026-11-22T15:00:00Z")), 60_000);
  assert.equal(barSlotMs("NVDA", "5min", T0), 60_000);
  assert.equal(barSlotMs("NVDA", "1day", T0), 10 * 60_000);
});

// ---------- the governor ----------

test("governor: a call is refused when the minute's usage plus its cost would pass the tier, or take more than its share of the room; never waits", async () => {
  const clock = clockAt(T0);
  let used = 400, reads = 0;
  const g = createGovernor({ now: clock.now, readMeter: async () => { reads++; return { used, at: clock.now() }; } });
  assert.equal(await g.acquire(10, "user"), true);   // 410 <= 480, and 10 <= 15% of the 80 left
  assert.equal(await g.acquire(5, "user"), false);   // this instance's own spending since the reading counts toward its share
  assert.equal(await g.acquire(1, "critical"), true);
  assert.equal(await g.acquire(1, "background"), false);
  used = 470;
  clock.advance(2_000);
  assert.equal(await g.acquire(20, "user"), false);  // 470 + 20 > 480
  assert.equal(await g.acquire(2, "user"), true);    // one symbol may always go under the ceiling
  used = 100; clock.advance(2_000);
  assert.equal(await g.acquire(1, "fast"), true);
  assert.equal(reads, 3); // the meter is read once per two seconds at most
});

test("governor: each instance has its own cap, so a stale meter cannot let one instance flood the minute", async () => {
  const clock = clockAt(T0);
  const g = createGovernor({ now: clock.now, readMeter: async () => ({ used: 0, at: clock.now() }), perMinute: 150, burst: 40 });
  let granted = 0;
  for (let i = 0; i < 100; i++) if (await g.acquire(1, "user")) granted++;
  assert.equal(granted, 40);
  clock.advance(10_000); // 25 credits refilled
  granted = 0; for (let i = 0; i < 100; i++) if (await g.acquire(1, "user")) granted++;
  assert.equal(granted, 25);
  // A 50-credit call larger than the burst goes once the bucket is full, then the debt is repaid first.
  clock.advance(60_000);
  assert.equal(await g.acquire(50, "user"), true);
  assert.equal(await g.acquire(1, "user"), false);
});

test("governor: an unreadable meter limits the instance to its small allowance; a 429 stops everything but critical until the next minute", async () => {
  const clock = clockAt(T0);
  const g = createGovernor({ now: clock.now, readMeter: async () => null, unknownPerMinute: 60, burst: 40 });
  let granted = 0;
  for (let i = 0; i < 100; i++) if (await g.acquire(1, "user")) granted++;
  assert.equal(granted, 40);
  const h = createGovernor({ now: clock.now, readMeter: async () => ({ used: 0, at: clock.now() }) });
  h.limited();
  assert.equal(await h.acquire(1, "user"), false);
  assert.equal(await h.acquire(1, "critical"), true);
  clock.advance(62_000);
  assert.equal(await h.acquire(1, "user"), true);
});

test("governor: a reading from the previous minute is not carried into the new one", async () => {
  const clock = clockAt(T0 + 59_000);
  let used = 499;
  const g = createGovernor({ now: clock.now, readMeter: async () => ({ used, at: clock.now() }), meterMaxAgeMs: 5_000 });
  assert.equal(await g.acquire(5, "user"), false);
  used = 0; clock.advance(2_000); // a new minute: the meter is read again even though it is two seconds old
  assert.equal(await g.acquire(5, "user"), true);
});

// ---------- the shared reader ----------
const SPEC = { name: "q", slotMs: 60_000, staleMs: STALE_LIMIT_MS };

test("reader: a hundred members asking for the same symbol at once share one provider read", async () => {
  const clock = clockAt(T0), reader = createReader(memoryStore(), clock.now);
  let calls = 0;
  const fetch = async () => { calls++; await new Promise(r => setTimeout(r, 5)); return { price: 1 }; };
  const all = await Promise.all(Array.from({ length: 100 }, () => reader.read(SPEC, "NVDA", fetch)));
  assert.equal(calls, 1);
  assert.ok(all.every(r => r.fresh && r.value.price === 1));
});

test("reader: another instance finds the shared copy of the slot and spends nothing; the next slot reads again once", async () => {
  const clock = clockAt(T0), store = memoryStore();
  const a = createReader(store, clock.now), b = createReader(store, clock.now);
  let calls = 0;
  const fetch = async () => ({ price: ++calls });
  await a.read(SPEC, "MU", fetch);
  assert.equal((await b.read(SPEC, "MU", fetch)).value.price, 1);
  assert.equal(calls, 1);
  clock.advance(60_000);
  assert.equal((await b.read(SPEC, "MU", fetch)).value.price, 2);
  assert.equal((await a.read(SPEC, "MU", fetch)).value.price, 2);
  assert.equal(calls, 2);
});

test("reader: a refused or failed read shows the last good copy with its own time, and is not stored as fresh", async () => {
  const clock = clockAt(T0), store = memoryStore();
  await createReader(store, clock.now).read(SPEC, "AVGO", async () => ({ price: 10 }));
  clock.advance(25 * 60_000);
  const other = createReader(store, clock.now); // a fresh instance: only the shared store remembers
  const got = await other.read(SPEC, "AVGO", async () => { throw new Error("twelve-budget"); });
  assert.equal(got.fresh, false); assert.equal(got.value.price, 10); assert.equal(got.at, T0);
  const later = await other.read(SPEC, "AVGO", async () => ({ price: 11 }));
  assert.equal(later.fresh, true); assert.equal(later.value.price, 11);
  assert.equal(await other.read(SPEC, "NEVER", async () => { throw new Error("x"); }), null);
});

test("reader: many symbols go out in chunks, at most maxFetch per request, never-read first; unknown symbols are remembered for the slot", async () => {
  const clock = clockAt(T0), reader = createReader(memoryStore(), clock.now);
  const batches = [];
  const fetchMany = async keys => { batches.push(keys); return new Map(keys.filter(k => k !== "NOPE").map(k => [k, { price: 1 }])); };
  const keys = Array.from({ length: 30 }, (_, i) => `T${i}`).concat("NOPE");
  const first = await reader.readMany(SPEC, keys, fetchMany, { maxFetch: 24 });
  assert.equal(batches.flat().length, 24); assert.deepEqual(batches.map(b => b.length), [12, 12]);
  assert.equal(Object.keys(first).length, 24);
  const second = await reader.readMany(SPEC, keys, fetchMany, { maxFetch: 24 });
  assert.equal(batches.flat().length, 31); // only the seven not read yet
  assert.equal(second.NOPE.value, null);
  await reader.readMany(SPEC, keys, fetchMany, { maxFetch: 24 });
  assert.equal(batches.flat().length, 31); // the unknown symbol is not asked again within the slot
});


test("load: 1,000 members at once (500 watchlists polled every 15 s, 500 browsing 5 pages a minute) never pass the plan, price alerts always run, every screen gets a price", { timeout: 120_000 }, async () => {
  const run = await simulate();
  assert.equal(run.refused, 0, `refused ${run.refused}`);
  assert.ok(run.peak <= PLAN_CREDITS_PER_MINUTE, `peak ${run.peak}`);
  assert.equal(run.alertSkipped, 0);
  assert.equal(run.errors, 0);
  assert.equal(run.served, run.lookups, "every lookup is answered, fresh or with the last good copy");
  assert.ok(run.fresh / run.lookups > 0.5, `fresh ${(run.fresh / run.lookups).toFixed(2)}`);
  console.log(`new design: peak ${run.peak}/min, per minute ${run.minutes.join(",")}, fresh ${(100 * run.fresh / run.lookups).toFixed(1)}%, oldest copy ${(run.maxAgeMs / 60_000).toFixed(0)} min`);
});

test("load: the owner's example (200 active members, 5 pages a minute each) stays inside the plan even spread over sixteen server instances", { timeout: 120_000 }, async () => {
  const run = await simulate({ members: 200, instances: 16, minutes: 3, seed: 9 });
  console.log(`example: peak ${run.peak}, refused ${run.refused}, minutes ${run.minutes.join(",")}, alerts skipped ${run.alertSkipped}, site ${run.site}`);
  assert.equal(run.refused, 0); assert.ok(run.peak <= PLAN_CREDITS_PER_MINUTE, `peak ${run.peak}`); assert.equal(run.alertSkipped, 0); assert.equal(run.errors, 0);
});

test("load: the design before this change passes the plan under the same traffic (the failure the owner saw)", { timeout: 120_000 }, async () => {
  const run = await simulate({ legacy: true, members: 200, minutes: 2, seed: 11 });
  assert.ok(run.refused > 0, "the old design ran into the plan's limit");
  console.log(`old design: ${run.refused} calls refused with 429, wanted far above ${PLAN_CREDITS_PER_MINUTE}/min`);
});
