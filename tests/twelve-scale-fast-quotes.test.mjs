import test from "node:test";
import assert from "node:assert/strict";
import { FAST_MAX_PER_REQUEST, FAST_SLOT_MS, createReader, fastQuoteSpec, fastRefresh } from "../lib/research/twelve-budget.ts";
import { T0, clockAt, memoryStore } from "./support/twelve-load-sim.mjs";

// Owner, Nov 26: the 15-second quote refresh (fast=1) must cost one read per symbol and 15-second slot for everyone, however many members
// have a watchlist open (before: every request read its own up to 12 symbols again).
const MAIN = { name: "md-quote-v1", slotMs: 60_000, staleMs: 3 * 86_400_000 };
const SYMBOLS = Array.from({ length: 12 }, (_, i) => "S" + i);

function world() {
  const clock = clockAt(T0), store = memoryStore();
  const provider = { calls: 0, credits: 0, async fetch(keys) { provider.calls++; provider.credits += keys.length; await null; return new Map(keys.map(k => [k, { ticker: k, price: 100, at: clock.now() }])); } };
  return { clock, store, provider, instances: Array.from({ length: 4 }, () => createReader(store, clock.now)) };
}
/** One member's request on one instance: the minute copy first (as loadMarketQuotesWithRefresh), then the fast refresh. */
async function request(w, reader) {
  const got = await reader.readMany(MAIN, SYMBOLS, keys => w.provider.fetch(keys));
  return fastRefresh(reader, MAIN, got, keys => w.provider.fetch(keys), w.clock.now);
}

test("dedup: 1,000 members polling every 15 seconds cost what one member does: one read per symbol, slot and instance at most", async () => {
  const cost = {};
  for (const members of [1, 1000]) {
    const w = world();
    // Minute copies read 20 seconds ago by someone.
    await w.instances[0].readMany(MAIN, SYMBOLS, keys => w.provider.fetch(keys));
    w.clock.advance(20_000);
    const start = w.provider.credits;
    for (let slot = 0; slot < 4; slot++) {
      const before = w.provider.credits;
      const answers = await Promise.all(Array.from({ length: members }, (_, i) => request(w, w.instances[i % 4])));
      assert.ok(answers.every(a => a.granted));
      // Simultaneous first requests on four instances may each read once (the cross-instance copy is written after the read); never per member.
      assert.ok(w.provider.credits - before <= SYMBOLS.length * w.instances.length, `${members} members, slot ${slot}: ${w.provider.credits - before}`);
      w.clock.advance(FAST_SLOT_MS);
    }
    cost[members] = w.provider.credits - start;
  }
  // Before (Nov 26 audit): each of the 1,000 requests read its 12 symbols again: 12,000 credits a slot.
  assert.ok(cost[1000] <= SYMBOLS.length * 4 * 4, JSON.stringify(cost));
  // Requests that come one after another (the usual case) share one read per symbol and slot for the whole site.
  const w = world();
  await w.instances[0].readMany(MAIN, SYMBOLS, keys => w.provider.fetch(keys));
  w.clock.advance(20_000);
  const before = w.provider.credits;
  for (let i = 0; i < 100; i++) { await request(w, w.instances[i % 4]); w.clock.advance(100); }
  assert.ok(w.provider.credits - before <= SYMBOLS.length * 2, `${w.provider.credits - before}`); // a key's slot may turn once in those 10 s
});

test("the reading instance also stores the minute copy; a refused fast read keeps the minute copy and reports 60s", async () => {
  const w = world(), reader = w.instances[0];
  await reader.readMany(MAIN, SYMBOLS, keys => w.provider.fetch(keys));
  w.clock.advance(20_000);
  const { got, granted } = await request(w, reader);
  assert.equal(granted, true);
  assert.ok(SYMBOLS.every(s => w.clock.now() - got[s].at < FAST_SLOT_MS));
  // Another instance's minute read finds the fresh copy: no provider call.
  const calls = w.provider.calls;
  await w.instances[1].readMany(MAIN, SYMBOLS, () => assert.fail("no read"));
  assert.equal(w.provider.calls, calls);
  // Refused (the fast tier had no room): the minute copy stays, the answer says 60s, and nothing is retried.
  w.clock.advance(20_000);
  let refusals = 0;
  const minute = await w.instances[2].readMany(MAIN, SYMBOLS, keys => w.provider.fetch(keys));
  const refused = await fastRefresh(w.instances[2], MAIN, minute, async () => { refusals++; throw new Error("twelve-budget"); }, w.clock.now);
  assert.equal(refused.granted, false);
  assert.equal(refusals, 1);
  assert.ok(SYMBOLS.every(s => refused.got[s].value));
  assert.equal(fastQuoteSpec.slotMs, 15_000);
  assert.equal(FAST_MAX_PER_REQUEST, 12);
});
