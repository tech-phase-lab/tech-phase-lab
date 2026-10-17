import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleLeaseRenewal } from '../lib/research/display-lease.ts';

test('silent renewal does not clear the body, but the old lease still expires if renewal stalls', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  let visible = true, requests = 0;
  scheduleLeaseRenewal(61_000, () => { requests++; }, () => { visible = false; });
  t.mock.timers.tick(40_000);
  assert.equal(requests, 1); assert.equal(visible, true);
  t.mock.timers.tick(19_999); assert.equal(visible, true);
  t.mock.timers.tick(1); assert.equal(visible, false);
});

test('a verified renewal replaces the old expiry and cleanup cancels both timers', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  let visible = true, requests = 0;
  let cancel = scheduleLeaseRenewal(61_000, () => {
    requests++; cancel();
    cancel = scheduleLeaseRenewal(Date.now() + 60_000, () => { requests++; }, () => { visible = false; });
  }, () => { visible = false; });
  t.mock.timers.tick(40_000); t.mock.timers.tick(20_000);
  assert.equal(visible, true); assert.equal(requests, 1);
  cancel(); t.mock.timers.tick(120_000);
  assert.equal(requests, 1); assert.equal(visible, true);
});
