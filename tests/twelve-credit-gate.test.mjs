import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUNDLE_CREDIT_COST, COMPARISON_CREDIT_BUDGET, parseUsage, retryOnceIfLimited, shareInflight, TwelveBusyError, waitForCredits } from "../lib/research/twelve-credit-gate.ts";

const clock = () => { let t = 0; return { now: () => t, sleep: async ms => { t += ms; } }; };

test("a quiet minute lets the read start at once; one read costs 251 and the budget is 350", async () => {
  assert.equal(BUNDLE_CREDIT_COST, 251); assert.equal(COMPARISON_CREDIT_BUDGET, 350);
  const c = clock(); let reads = 0;
  await waitForCredits({ ...c, readUsage: async () => { reads++; return 4; } });
  assert.equal(reads, 1); assert.equal(c.now(), 0);
});

test("a busy minute waits (polling every 5 s) and goes ahead once usage falls", async () => {
  const c = clock(); const seen = [400, 300, 99];
  await waitForCredits({ ...c, readUsage: async () => seen.shift() });
  assert.equal(c.now(), 10_000); // 400 and 300 both leave no room for 251 under 350; 99 does (99+251=350)
});

test("still busy after 25 s gives up with the busy error; nothing is cached by this layer", async () => {
  const c = clock(); let reads = 0;
  await assert.rejects(waitForCredits({ ...c, readUsage: async () => { reads++; return 500; } }), TwelveBusyError);
  assert.ok(c.now() <= 25_000 && reads >= 5);
});

test("an unreadable meter never stops the comparison", async () => {
  const c = clock();
  await waitForCredits({ ...c, readUsage: async () => { throw new Error("down"); } });
  await waitForCredits({ ...c, readUsage: async () => null });
  assert.equal(parseUsage({ current_usage: 12, plan_limit: 610 }), 12);
  assert.equal(parseUsage({ code: 401 }), null); assert.equal(parseUsage(null), null); assert.equal(parseUsage({ current_usage: -1 }), null);
});

test("the same company asked for together is read once; a failure is not kept", async () => {
  const running = new Map(); let runs = 0, fail = true;
  const start = () => new Promise((resolve, reject) => { runs++; setTimeout(() => fail ? reject(new Error("x")) : resolve("ok"), 5); });
  const first = await Promise.allSettled([shareInflight(running, "MU", start), shareInflight(running, "MU", start), shareInflight(running, "MU", start)]);
  assert.equal(runs, 1); assert.ok(first.every(r => r.status === "rejected")); assert.equal(running.size, 0);
  fail = false;
  assert.deepEqual(await Promise.all([shareInflight(running, "MU", start), shareInflight(running, "NVDA", start)]), ["ok", "ok"]);
  assert.equal(runs, 3);
});

test("a rate-limited answer is retried once after the pause, never twice", async () => {
  const c = clock(); let attempts = 0;
  const value = await retryOnceIfLimited(async () => { attempts++; return { limited: true, value: "gave-up" }; }, c.sleep);
  assert.equal(attempts, 2); assert.equal(c.now(), 20_000); assert.equal(value, "gave-up");
  attempts = 0;
  assert.equal(await retryOnceIfLimited(async () => ({ limited: attempts++ === 0, value: attempts }), c.sleep), 2);
  attempts = 0;
  assert.equal(await retryOnceIfLimited(async () => { attempts++; return { limited: false, value: "fine" }; }, c.sleep), "fine"); assert.equal(attempts, 1);
});

test("the collector uses the gate before reading, inside the queue, and shares in-flight reads", () => {
  const source = readFileSync(new URL("../lib/research/twelve-data-collector.ts", import.meta.url), "utf8");
  assert.match(source, /serial\(async \(\) => \{\s*await waitForCredits/);
  assert.match(source, /shareInflight\(running, ticker/);
  assert.match(source, /retryOnceIfLimited/);
  assert.doesNotMatch(source, /attempt < 2/);
});
