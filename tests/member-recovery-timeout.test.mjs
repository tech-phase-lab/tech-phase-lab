import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverMember, waitForIdentity } from '../lib/research/member-recovery.ts';

test('a stalled SDK refresh is cancelled without waiting for the SDK and the next attempt works', async t => {
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => { reads++; return Response.json({ status: 'signed-in', plan: 'pro' }); });
  const controller = new AbortController();
  const stalled = recoverMember(() => new Promise(() => {}), controller.signal);
  const rejected = assert.rejects(stalled, /deadline/);
  controller.abort(new Error('deadline'));
  await rejected;
  assert.equal(reads, 0);
  const next = await recoverMember(async () => {}, new AbortController().signal);
  assert.equal(next.member.plan, 'pro');
  assert.equal(reads, 1);
});

test('the forced renewal after a signed-out response also obeys cancellation', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'signed-out' }));
  const controller = new AbortController();
  let forced;
  const reached = new Promise(resolve => { forced = resolve; });
  const result = recoverMember(async force => { if (force) { forced(); await new Promise(() => {}); } }, controller.signal);
  const rejected = assert.rejects(result, /deadline/);
  await reached;
  controller.abort(new Error('deadline'));
  await rejected;
});

test('late SDK rejection after cancellation is handled and cannot replace the cancellation', async () => {
  let fail;
  const task = new Promise((_, reject) => { fail = reject; });
  const controller = new AbortController();
  const result = waitForIdentity(task, controller.signal);
  const rejected = assert.rejects(result, /cancelled/);
  controller.abort(new Error('cancelled'));
  await rejected;
  fail(new Error('late SDK failure'));
  await new Promise(resolve => setImmediate(resolve));
});

test('already-cancelled membership checks do not start identity work', async () => {
  let calls = 0;
  await assert.rejects(recoverMember(async () => { calls++; }, AbortSignal.abort(new Error('cancelled'))), /cancelled/);
  assert.equal(calls, 0);
});
