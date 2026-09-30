import assert from "node:assert/strict";
import test from "node:test";
import { createNewsPoller, newsPollDelay } from "../lib/research/news-poller.ts";

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
  assert.deepEqual(clock.pending(), []);
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
