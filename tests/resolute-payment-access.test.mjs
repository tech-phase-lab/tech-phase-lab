import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxAccess } from '../services/resolute-api/payments/access.mjs';
import { paymentHttp } from '../services/resolute-api/payments/http.mjs';
const grant = (kind, start, end, state = 'active', order_state = 'paid') => ({
  kind, starts_at: `${start}-01-01T00:00:00Z`, expires_at: `${end}-01-01T00:00:00Z`, state, order_state,
});
const at = year => `${year}-01-01T00:00:00Z`;
test('perpetual tools and annual alerts remain independent; renewal alone never grants tools', () => {
  const initial = grant('initial', 2026, 2027);
  assert.equal(sandboxAccess([initial], at(2025)).canUseTools, false);
  assert.equal(sandboxAccess([initial], at(2026)).canReceiveNotifications, true);
  const expired = sandboxAccess([initial], at(2027));
  assert.equal(expired.canUseTools, true);
  assert.equal(expired.canReceiveNotifications, false);
  assert.equal(sandboxAccess([grant('renewal', 2027, 2028)], at(2027)).canUseTools, false);
  assert.equal(sandboxAccess([grant('renewal', 2027, 2028)], at(2027)).canReceiveNotifications, false);
});
test('refunds and disputes remove only their coverage; a missing year is never bridged', () => {
  const initial = grant('initial', 2026, 2027);
  const renewal = grant('renewal', 2027, 2028);
  const next = grant('renewal', 2028, 2029);
  assert.equal(sandboxAccess([next, initial, renewal], at(2027)).alertPeriods.length, 1);
  for (const state of ['revoked', 'suspended']) {
    const rows = [initial, { ...renewal, state }, next];
    assert.equal(sandboxAccess(rows, at(2027)).canReceiveNotifications, false);
    assert.equal(sandboxAccess(rows, at(2028)).canReceiveNotifications, true);
    assert.equal(sandboxAccess(rows, at(2027)).alertPeriods.length, 2);
    assert.equal(sandboxAccess([{ ...initial, state }, renewal], at(2027)).canReceiveNotifications, false);
    assert.equal(sandboxAccess([{ ...initial, order_state: state }], at(2026)).canUseTools, false);
  }
  assert.equal(sandboxAccess([{ ...initial, order_state: null }], at(2026)).canUseTools, false);
  assert.equal(sandboxAccess([], at(2026)).canUseTools, false);
  assert.throws(() => sandboxAccess([{ ...initial, expires_at: 'bad' }], at(2026)));
});
test('access endpoint uses authenticated identity only, blocks outsiders and never accepts query overrides', async () => {
  const calls = [];
  const make = user => paymentHttp({ engine: {}, store: { access: async id => { calls.push(id); return { sandbox: true }; } },
    authenticate: async () => user, enabled: true, allowedUsers: ['user_test'] });
  const request = (suffix = '', method = 'GET') => new Request(`https://internal.test/internal/v1/payments/access${suffix}`, { method });
  assert.equal((await make(null)(request())).status, 401);
  assert.equal((await make('user_other')(request())).status, 403);
  assert.equal((await make('user_test')(request('?user=user_other'))).status, 400);
  assert.equal((await make('user_test')(request('', 'POST'))).status, 404);
  const response = await make('user_test')(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(calls, ['user_test']);
  assert.deepEqual(await response.json(), { sandbox: true });
});
