import assert from "node:assert/strict";
import test from "node:test";
import { createNewsPoller, newsPollDelay, NEWS_REQUEST_TIMEOUT_MS } from "../lib/research/news-poller.ts";

const flush = () => new Promise(resolve => setImmediate(resolve));

function scheduler() {
  let next = 1;
  const tasks = new Map();
  return {
    schedule(callback, delay) { const id = next++; tasks.set(id, { callback, delay }); return id; },
    cancel(id) { tasks.delete(id); },
    pending() { return [...tasks.values()].map(task => task.delay); },
    async run() {
      const [id, task] = tasks.entries().next().value;
      tasks.delete(id);
      task.callback();
      await flush();
    },
  };
}

test("news poll retry is bounded and a successful reconnect restores the regular interval", async () => {
  const clock = scheduler();
  const outcomes = [new Error("offline"), { ok: true }];
  const received = [];
  let failures = 0;
  const poller = createNewsPoller({
    load: async () => { const value = outcomes.shift(); if (value instanceof Error) throw value; return value; },
    onSuccess: value => received.push(value),
    onFailure: () => failures++,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  poller.start();
  assert.deepEqual(clock.pending(), [0]);
  await clock.run();
  assert.equal(failures, 1);
  assert.deepEqual(clock.pending(), [5_000]);
  poller.wake();
  assert.deepEqual(clock.pending(), [0]);
  await clock.run();
  assert.deepEqual(received, [{ ok: true }]);
  assert.deepEqual(clock.pending(), [5_000]);
  poller.stop();
  assert.deepEqual(clock.pending(), []);
});

test("wake during an in-flight request queues exactly one immediate reconnect", async () => {
  const clock = scheduler();
  let resolve;
  const first = new Promise(done => { resolve = done; });
  let calls = 0;
  const poller = createNewsPoller({
    load: async () => { calls += 1; return calls === 1 ? first : "reconnected"; },
    onSuccess: () => {},
    onFailure: () => {},
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  poller.start();
  await clock.run();
  poller.wake();
  poller.wake();
  assert.deepEqual(clock.pending(), [NEWS_REQUEST_TIMEOUT_MS]);
  resolve("initial");
  await flush();
  assert.deepEqual(clock.pending(), [0]);
  await clock.run();
  assert.equal(calls, 2);
  poller.stop();
});

test("stopping aborts an active request and schedules no retry", async () => {
  const clock = scheduler();
  let observedSignal;
  const poller = createNewsPoller({
    load: signal => { observedSignal = signal; return new Promise(() => {}); },
    onSuccess: () => assert.fail("unexpected success"),
    onFailure: () => assert.fail("abort is not a failure"),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  poller.start();
  await clock.run();
  poller.stop();
  assert.equal(observedSignal.aborted, true);
  assert.deepEqual(clock.pending(), []);
  assert.equal(newsPollDelay(20), 30_000);
});

test("a stalled news request times out, retries, and cannot overwrite the recovered feed", async () => {
  const clock = scheduler();
  let resolveLate;
  let timedOutSignal;
  let calls = 0;
  let failures = 0;
  const received = [];
  const poller = createNewsPoller({
    load: signal => {
      if (++calls !== 1) return Promise.resolve("recovered");
      timedOutSignal = signal;
      return new Promise(resolve => { resolveLate = resolve; });
    },
    onSuccess: value => received.push(value),
    onFailure: () => failures++,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  poller.start();
  await clock.run();
  assert.deepEqual(clock.pending(), [NEWS_REQUEST_TIMEOUT_MS]);
  await clock.run();
  assert.equal(timedOutSignal.aborted, true);
  assert.equal(failures, 1);
  assert.deepEqual(clock.pending(), [5_000]);
  await clock.run();
  assert.deepEqual(received, ["recovered"]);
  resolveLate("outdated");
  await flush();
  assert.deepEqual(received, ["recovered"]);
  assert.deepEqual(clock.pending(), [5_000]);
  poller.stop();
});

test("an aborted previous session cannot reschedule or fail a restarted poller", async () => {
  const clock = scheduler();
  let calls = 0;
  const received = [];
  const poller = createNewsPoller({
    load: () => ++calls === 1 ? new Promise(() => {}) : Promise.resolve("current"),
    onSuccess: value => received.push(value),
    onFailure: () => assert.fail("stopped session must not fail"),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  poller.start();
  await clock.run();
  poller.stop();
  poller.start();
  await flush();
  assert.deepEqual(clock.pending(), [0]);
  await clock.run();
  assert.deepEqual(received, ["current"]);
  assert.deepEqual(clock.pending(), [5_000]);
  poller.stop();
});

test('pause discards a stalled request and resume coalesces lifecycle events without a timeout wait', async () => {
  const clock = scheduler();
  let oldSignal, resolveOld, calls = 0, failures = 0;
  const values = [];
  const poller = createNewsPoller({
    load: signal => ++calls === 1 ? (oldSignal = signal, new Promise(resolve => { resolveOld = resolve; })) : Promise.resolve('current'),
    onSuccess: value => values.push(value), onFailure: () => failures++,
    schedule: clock.schedule, cancel: clock.cancel,
  });
  poller.start(); await clock.run(); poller.pause();
  assert.equal(oldSignal.aborted, true); assert.deepEqual(clock.pending(), []);
  poller.resume(); poller.resume(); await flush();
  assert.deepEqual(clock.pending(), [0]); await clock.run();
  assert.deepEqual(values, ['current']); assert.equal(calls, 2); assert.equal(failures, 0);
  poller.resume(); assert.deepEqual(clock.pending(), [5000]);
  resolveOld('old'); await flush(); assert.deepEqual(values, ['current']);
  poller.stop();
});
