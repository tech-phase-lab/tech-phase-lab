// Speed, Nov 26: /api/research/market/quotes (p95 2.7 s) and /board (p95 1.4 s) were slow only for the first request of a new slot, which
// waited for the provider. With `swr` that request gets the previous slot's copy at once and the slot's single read runs in the background.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createReader } from "../lib/research/twelve-budget.ts";
import { T0, clockAt, memoryStore } from "./support/twelve-load-sim.mjs";

const spec = { name: "swr-test", slotMs: 60_000, staleMs: 3 * 86_400_000, swr: true };

test("one key: the first request of a new slot is answered at once with the earlier copy; one provider read refreshes it", async () => {
  const clock = clockAt(T0), store = memoryStore(), pending = [];
  const reader = createReader(store, clock.now, null, work => pending.push(work));
  let calls = 0, release;
  await reader.read(spec, "NVDA", async () => { calls++; return 100; });
  clock.advance(61_000);
  const gate = new Promise(resolve => { release = resolve; });
  const fetch = async () => { calls++; await gate; return 101; };
  // Five requests in the new slot: all answered with the earlier copy, without waiting; the provider is read once.
  const answers = await Promise.all(Array.from({ length: 5 }, () => reader.read(spec, "NVDA", fetch)));
  assert.deepEqual(answers.map(a => [a.value, a.fresh]), Array(5).fill([100, false]));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 2);
  release(); await Promise.all(pending);
  const next = await reader.read(spec, "NVDA", fetch);
  assert.deepEqual([next.value, next.fresh], [101, true]);
  assert.equal(calls, 2);
});

test("a key never read before still waits for its first read (nothing to show yet)", async () => {
  const clock = clockAt(T0), reader = createReader(memoryStore(), clock.now);
  const got = await reader.read(spec, "AMD", async () => 7);
  assert.deepEqual([got.value, got.fresh], [7, true]);
});

test("many keys: earlier copies answer at once, new keys are read now, and each key is read once per slot", async () => {
  const clock = clockAt(T0), store = memoryStore(), pending = [];
  const reader = createReader(store, clock.now, null, work => pending.push(work));
  const asked = [];
  const fetchMany = async keys => { asked.push([...keys]); return new Map(keys.map(k => [k, `${k}@${clock.t}`])); };
  await reader.readMany(spec, ["NVDA", "MU"], fetchMany);
  clock.advance(61_000);
  const got = await reader.readMany(spec, ["NVDA", "MU", "AVGO"], fetchMany);
  assert.equal(got.NVDA.fresh, false); assert.equal(got.MU.fresh, false);
  assert.equal(got.AVGO.fresh, true);
  await Promise.all(pending);
  const again = await reader.readMany(spec, ["NVDA", "MU", "AVGO"], fetchMany);
  assert.ok(Object.values(again).every(r => r.fresh));
  // First fill, then this slot's one read of the three keys; the third request read nothing.
  assert.deepEqual(asked.map(k => k.sort()), [["MU", "NVDA"], ["AVGO", "MU", "NVDA"]]);
});

test("the quote and board copies use it; the minute job still reads synchronously; the refresh outlives the response", () => {
  const data = readFileSync(new URL("../lib/research/market-data.ts", import.meta.url), "utf8");
  assert.match(data, /name: "md-quote-v1", slotMs: quoteSlotMs\("AAPL", now\), staleMs: STALE_LIMIT_MS, swr: true/);
  assert.match(data, /name: "md-board-v1", slotMs: fast \? 15_000 : 60_000, staleMs: STALE_LIMIT_MS, swr: true/);
  assert.match(data, /sharedReader\.read<Board>\(\{ \.\.\.boardSpec\(false\), swr: false \}, job\.id/);
  const gateway = readFileSync(new URL("../lib/research/twelve-gateway.ts", import.meta.url), "utf8");
  assert.match(gateway, /after\(\(\) => work\.catch\(\(\) => undefined\)\)/);
  assert.match(gateway, /createReader\(dataCache, Date\.now, durableCopies, keepRunning\)/);
});
