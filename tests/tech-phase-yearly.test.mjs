import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { offer, planKey, periodOfMinor, assertPlan, createPaypal, sandboxConfig, liveConfig } from '../services/tech-phase-billing/paypal.mjs';
import { billingStore } from '../services/tech-phase-billing/store.mjs';
import { checkoutService } from '../services/tech-phase-billing/checkout.mjs';
import { monthlyBoundary, verifiedPeriod, reconciliationService, assertSubscription } from '../services/tech-phase-billing/settlement.mjs';
import { accountContract } from '../services/tech-phase-billing/account-view.mjs';
import { sandboxHandler } from '../services/tech-phase-billing/http.mjs';
import { liveHandler } from '../services/tech-phase-billing/live-http.mjs';
import { livePreflight } from '../services/tech-phase-billing/live-preflight.mjs';

const P = c => 'P-' + c.repeat(24), sid = 'I-ABCDEFGHIJKL', rid = '00000000-0000-4000-8000-000000000001';
const plans = { JPY: P('J'), USD: P('U'), JPY_YEAR: P('Y'), USD_YEAR: P('Z') };
const sandboxEnv = () => ({ TECH_PHASE_PAYPAL_ENV: 'sandbox', TECH_PHASE_PAYPAL_CLIENT_ID: 'x', TECH_PHASE_PAYPAL_CLIENT_SECRET: 'y', TECH_PHASE_PAYPAL_WEBHOOK_ID: 'WH-x',
  TECH_PHASE_PAYPAL_PLAN_JPY: plans.JPY, TECH_PHASE_PAYPAL_PLAN_USD: plans.USD });
const yearPlan = (currency, period = 'year') => ({ id: plans[planKey(currency, period)], status: 'ACTIVE', quantity_supported: false,
  billing_cycles: [{ tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, frequency: { interval_unit: period === 'year' ? 'YEAR' : 'MONTH', interval_count: 1 },
    pricing_scheme: { fixed_price: { currency_code: currency, value: offer(currency, period).value } } }], payment_preferences: { auto_bill_outstanding: false } });

test('yearly offers: 17% below twelve months, period derived from the stored price', () => {
  assert.equal(offer('JPY', 'year').minor, 29800); assert.equal(offer('USD', 'year').minor, 20000);
  assert.equal(offer('JPY', 'year').value, '29800'); assert.equal(offer('USD', 'year').value, '200.00');
  for (const c of ['JPY', 'USD']) assert.ok(1 - offer(c, 'year').minor / (offer(c, 'month').minor * 12) > 0.166);
  assert.equal(periodOfMinor('JPY', 2980), 'month'); assert.equal(periodOfMinor('JPY', 29800), 'year');
  assert.equal(periodOfMinor('USD', 2000), 'month'); assert.equal(periodOfMinor('USD', 20000), 'year');
  assert.throws(() => periodOfMinor('JPY', 20000)); assert.throws(() => offer('JPY', 'week')); assert.throws(() => offer('JPY', '__proto__'));
  assert.deepEqual([planKey('JPY'), planKey('USD', 'year')], ['JPY', 'USD_YEAR']);
});
test('configuration: yearly plans are optional, validated and never shared with another plan', () => {
  const base = { ...sandboxEnv() };
  assert.equal(sandboxConfig(base).plans.JPY_YEAR, undefined);
  const withYear = sandboxConfig({ ...base, TECH_PHASE_PAYPAL_PLAN_JPY_YEAR: plans.JPY_YEAR, TECH_PHASE_PAYPAL_PLAN_USD_YEAR: plans.USD_YEAR });
  assert.equal(withYear.plans.JPY_YEAR, plans.JPY_YEAR); assert.equal(withYear.plans.USD_YEAR, plans.USD_YEAR);
  assert.throws(() => sandboxConfig({ ...base, TECH_PHASE_PAYPAL_PLAN_JPY_YEAR: 'nope' }), /INVALID_PLAN/);
  const live = { TECH_PHASE_PAYPAL_ENV: 'live', TECH_PHASE_BILLING_LIVE_ORIGIN: 'https://techphase.example.com', TECH_PHASE_PAYPAL_LIVE_CLIENT_ID: 'x', TECH_PHASE_PAYPAL_LIVE_CLIENT_SECRET: 'y',
    TECH_PHASE_PAYPAL_LIVE_WEBHOOK_ID: 'w', TECH_PHASE_PAYPAL_LIVE_PLAN_JPY: plans.JPY, TECH_PHASE_PAYPAL_LIVE_PLAN_USD: plans.USD,
    TECH_PHASE_PAYPAL_LIVE_PLAN_JPY_YEAR: plans.JPY_YEAR, TECH_PHASE_PAYPAL_LIVE_PLAN_USD_YEAR: plans.USD_YEAR };
  assert.equal(liveConfig(live).plans.USD_YEAR, plans.USD_YEAR);
  assert.throws(() => liveConfig({ ...live, TECH_PHASE_PAYPAL_LIVE_PLAN_USD_YEAR: plans.JPY }), /INVALID_PLAN/);
  assert.throws(() => liveConfig({ ...live, TECH_PHASE_PAYPAL_LIVE_PLAN_JPY_YEAR: plans.JPY }), /INVALID_PLAN/);
});
test('preflight lists the yearly plan variables as required (names only)', () => {
  const r = livePreflight({}, 'api');
  assert.ok(r.missing.includes('TECH_PHASE_PAYPAL_LIVE_PLAN_JPY_YEAR') && r.missing.includes('TECH_PHASE_PAYPAL_LIVE_PLAN_USD_YEAR'));
});
test('assertPlan: a yearly plan must be one yearly cycle at the yearly price; monthly and yearly cannot be swapped', () => {
  for (const c of ['JPY', 'USD']) {
    assert.equal(assertPlan(yearPlan(c), yearPlan(c).id, c, 'year').minor, offer(c, 'year').minor);
    assert.throws(() => assertPlan(yearPlan(c), yearPlan(c).id, c, 'month'), /PLAN_MISMATCH/);
    assert.throws(() => assertPlan(yearPlan(c, 'month'), yearPlan(c, 'month').id, c, 'year'), /PLAN_MISMATCH/);
  }
  const wrongPrice = yearPlan('JPY'); wrongPrice.billing_cycles[0].pricing_scheme.fixed_price.value = '2980';
  assert.throws(() => assertPlan(wrongPrice, wrongPrice.id, 'JPY', 'year'), /PLAN_MISMATCH/);
});
test('create: the server picks the yearly plan from currency and period; unconfigured yearly is refused', async () => {
  for (const currency of ['JPY', 'USD']) {
    const calls = [];
    const api = createPaypal({ ...sandboxConfig(sandboxEnv()), plans }, async (url, options) => {
      calls.push({ url, body: options.body?.startsWith('{') ? JSON.parse(options.body) : undefined });
      if (url.endsWith('/token')) return Response.json({ access_token: 't', expires_in: 300 });
      if (url.includes('/plans/')) { assert.ok(url.endsWith(plans[planKey(currency, 'year')])); return Response.json(yearPlan(currency)); }
      return Response.json({ id: sid, custom_id: rid, plan_id: plans[planKey(currency, 'year')], status: 'APPROVAL_PENDING',
        links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-ABCDEFGHIJKL' }] });
    });
    await api.create({ id: rid, currency, period: 'year' });
    const body = calls.at(-1).body;
    assert.equal(body.plan_id, plans[planKey(currency, 'year')]);
    assert.equal(body.plan.billing_cycles[0].pricing_scheme.fixed_price.value, offer(currency, 'year').value);
  }
  const monthlyOnly = createPaypal(sandboxConfig(sandboxEnv()), async () => { throw Error('must not call PayPal'); });
  await assert.rejects(monthlyOnly.create({ id: rid, currency: 'JPY', period: 'year' }), /INVALID_OFFER/);
});
test('HTTP: period is optional and only month|year; a plan id from the client is never accepted', async () => {
  const seen = [], services = async () => ({ checkout: { start: async (...a) => { seen.push(a); return { id: rid }; } }, store: {} });
  const sandbox = sandboxHandler({ env: { VERCEL_ENV: 'preview', TECH_PHASE_BILLING_SANDBOX_ENABLED: 'true', TECH_PHASE_PAYPAL_ENV: 'sandbox' }, identity: async () => 'user_owner', ownerId: 'user_owner', services });
  const req = body => new Request('https://example.test/api/create', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const t = { currency: 'USD', acceptedTerms: 'sandbox-v1' };
  assert.equal((await sandbox(req({ ...t, period: 'year' }), 'create')).status, 200);
  assert.equal((await sandbox(req(t), 'create')).status, 200);
  assert.deepEqual(seen.map(a => a[3]), ['year', 'month']);
  for (const bad of [{ ...t, period: 'week' }, { ...t, period: 1 }, { ...t, planId: plans.JPY_YEAR }, { ...t, period: 'year', planId: plans.JPY_YEAR }])
    assert.equal((await sandbox(req(bad), 'create')).status, 400);
  const liveSeen = [];
  const live = liveHandler({ env: { VERCEL_ENV: 'production', TECH_PHASE_PAYPAL_ENV: 'live', TECH_PHASE_BILLING_LIVE_ENABLED: 'true', TECH_PHASE_BILLING_LIVE_ENTITLEMENTS_ENABLED: 'true', TECH_PHASE_BILLING_LIVE_SALES_ENABLED: 'true', TECH_PHASE_BILLING_LIVE_ORIGIN: 'https://techphase.example.com' },
    identity: async () => 'user_abc123', services: async () => ({ abuse: null, checkout: { start: async (...a) => { liveSeen.push(a); return { id: rid }; } } }) });
  const lreq = body => new Request('https://techphase.example.com/api/create', { method: 'POST', headers: { origin: 'https://techphase.example.com', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const lt = { currency: 'JPY', acceptedTerms: 'pro-live-v1' };
  assert.equal((await live(lreq({ ...lt, period: 'year' }), 'create')).status, 200);
  assert.equal((await live(lreq({ ...lt, period: 'decade' }), 'create')).status, 400);
  assert.equal((await live(lreq({ ...lt, plan_id: plans.JPY_YEAR }), 'create')).status, 400);
  assert.equal(liveSeen[0][3], 'year');
});

const year = (count, start = '2026-10-20T00:00:00Z', currency = 'JPY') => {
  const money = { currency_code: currency, value: offer(currency, 'year').value };
  return { id: sid, custom_id: rid, plan_id: plans[planKey(currency, 'year')], status: 'ACTIVE', start_time: start,
    billing_info: { last_payment: { amount: money, time: monthlyBoundary(start, (count - 1) * 12) }, outstanding_balance: { currency_code: currency, value: '0' },
      failed_payments_count: 0, next_billing_time: monthlyBoundary(start, count * 12), cycle_executions: [{ tenure_type: 'REGULAR', sequence: 1, cycles_completed: count }] } };
};
const tx = (count, start = '2026-10-20T00:00:00Z', currency = 'JPY') => ({ id: 'TX-Y' + currency + count, status: 'COMPLETED', time: monthlyBoundary(start, (count - 1) * 12),
  amount_with_breakdown: { gross_amount: { currency_code: currency, value: offer(currency, 'year').value } } });
const yLocal = (currency = 'JPY') => ({ id: rid, paypal_id: sid, user_id: 'user_owner', currency, minor: offer(currency, 'year').minor });

test('verifiedPeriod: a yearly payment grants one year; renewals advance by twelve calendar months', () => {
  const now = Date.parse('2027-10-20T00:00:01Z');
  const first = verifiedPeriod(yLocal(), year(1), [tx(1)], plans, Date.parse('2026-10-20T00:00:01Z'));
  assert.equal(first.minor, 29800); assert.equal(first.periodStart, '2026-10-20T00:00:00.000Z'); assert.equal(first.periodEnd, '2027-10-20T00:00:00.000Z');
  const second = verifiedPeriod(yLocal(), year(2), [tx(2)], plans, now);
  assert.equal(second.periodStart, '2027-10-20T00:00:00.000Z'); assert.equal(second.periodEnd, '2028-10-20T00:00:00.000Z');
  const usd = verifiedPeriod(yLocal('USD'), year(1, '2026-10-20T00:00:00Z', 'USD'), [tx(1, '2026-10-20T00:00:00Z', 'USD')], plans, Date.parse('2026-10-20T00:00:01Z'));
  assert.equal(usd.minor, 20000); assert.equal(usd.periodEnd, '2027-10-20T00:00:00.000Z');
  // Leap day anchor: Feb 29 2028 -> Feb 28 2029 -> Feb 29 2032 (from the original anchor, never a drifted one).
  assert.equal(monthlyBoundary('2028-02-29T00:00:00Z', 12), '2029-02-28T00:00:00.000Z');
  assert.equal(monthlyBoundary('2028-02-29T00:00:00Z', 48), '2032-02-29T00:00:00.000Z');
  // First renewal may be scheduled on the next UTC date (< 24h), as observed for monthly in Sandbox.
  const drift = year(1); drift.billing_info.next_billing_time = '2027-10-20T10:00:00Z';
  assert.equal(verifiedPeriod(yLocal(), drift, [tx(1)], plans, Date.parse('2026-10-20T00:00:01Z')).periodEnd, '2027-10-20T10:00:00.000Z');
});
test('verifiedPeriod refuses monthly/yearly mixups and unverified yearly evidence', () => {
  const t0 = Date.parse('2026-10-20T00:00:01Z');
  // yearly contract, but PayPal reports the monthly plan / a monthly amount / a one-month schedule
  assert.throws(() => verifiedPeriod(yLocal(), { ...year(1), plan_id: plans.JPY }, [tx(1)], plans, t0), /SETTLEMENT_REVIEW_REQUIRED/);
  const monthlyAmount = year(1); monthlyAmount.billing_info.last_payment.amount.value = '2980';
  assert.throws(() => verifiedPeriod(yLocal(), monthlyAmount, [tx(1)], plans, t0), /SETTLEMENT_REVIEW_REQUIRED/);
  const monthSchedule = year(1); monthSchedule.billing_info.next_billing_time = '2026-11-20T00:00:00Z';
  assert.throws(() => verifiedPeriod(yLocal(), monthSchedule, [tx(1)], plans, t0), /SETTLEMENT_REVIEW_REQUIRED/);
  // monthly contract settled against a yearly plan id
  assert.throws(() => assertSubscription({ ...yLocal(), minor: 2980 }, year(1), plans), /SETTLEMENT_REVIEW_REQUIRED/);
  // yearly plan not configured on this deployment
  assert.throws(() => assertSubscription(yLocal(), year(1), { JPY: plans.JPY, USD: plans.USD }), /SETTLEMENT_REVIEW_REQUIRED/);
});

async function database(work) {
  const db = new PGlite();
  try {
    for (const name of ['001_billing_sandbox.sql', '002_paid_periods_sandbox.sql', '003_provider_billing_clock.sql', '004_dispute_holds_sandbox.sql', '008_yearly_plans.sql'])
      await db.exec(readFileSync(new URL('../db/tech-phase/' + name, import.meta.url), 'utf8'));
    const pool = { query: (...a) => db.query(...a), connect: async () => ({ query: (...a) => db.query(...a), release() {} }) };
    await work(billingStore(pool), db);
  } finally { await db.close(); }
}
test('ledger: yearly checkout, reconcile and entitlement for a full year (migration 008 applied)', () => database(async (store, db) => {
  for (const currency of ['JPY', 'USD']) {
    const user = 'user_' + currency;
    const created = [];
    const paypal = { create: async r => { created.push(r); return { id: sid.replace('ABCDEFGHIJKL', currency + 'AAAAAAAAA'), approvalUrl: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-ABCDEFGHIJKL' }; } };
    const svc = checkoutService({ store, paypal, termsVersion: 'sandbox-v1' });
    const out = await svc.start(user, currency, 'sandbox-v1', 'year');
    assert.equal(created[0].period, 'year');
    const row = await store.get(user, out.id);
    assert.equal(row.minor, offer(currency, 'year').minor);
    assert.equal((await store.summary(user)).subscription.period, 'year');
    assert.equal((await store.deletionContracts(user))[0].minor, offer(currency, 'year').minor); // the deletion check derives the plan from it
    // A different period for the same open contract is refused, not silently reused.
    await assert.rejects(store.reserve(user, currency, 'sandbox-v1', 'month'), /EXISTING_SUBSCRIPTION/);
    const start = '2026-10-20T00:00:00Z', r = year(1, start, currency); r.id = row.paypal_id; r.custom_id = row.id;
    const clock = Date.parse('2026-10-20T00:00:30Z');
    const recon = reconciliationService({ store, paypal: { get: async () => structuredClone(r), transactions: async () => ({ transactions: [tx(1, start, currency)] }) }, plans, now: () => clock });
    const res = await recon.reconcile(user, row.id);
    assert.equal(res.plan, 'pro'); assert.equal(res.proExpiresAt, '2027-10-20T00:00:00.000Z');
    assert.equal((await store.entitlement(user, Date.parse('2027-10-19T23:59:59Z'))).plan, 'pro');
    assert.equal((await store.entitlement(user, Date.parse('2027-10-20T00:00:00Z'))).plan, 'free');
    // Stopping auto-renewal keeps the paid year; the stored period survives the missing next_billing_time.
    r.status = 'CANCELLED'; delete r.billing_info.next_billing_time;
    assert.deepEqual(await recon.reconcile(user, row.id), res);
    // The account screen sees the yearly price, the yearly period and the stored access end.
    const detail = { ...r, status: 'ACTIVE', billing_info: { ...r.billing_info, next_billing_time: '2027-10-20T00:00:00Z' }, plan: { billing_cycles: [{ tenure_type: 'REGULAR', pricing_scheme: { fixed_price: { currency_code: currency, value: offer(currency, 'year').value } } }] } };
    const view = await accountContract({ store, paypal: { getDetails: async () => structuredClone(detail) }, plans }, user);
    assert.equal(view.period, 'year'); assert.equal(view.amount, offer(currency, 'year').value); assert.equal(view.nextBillingAt, '2027-10-20T00:00:00.000Z');
  }
  // The monthly 31-day ceiling still holds; a ~year window is accepted only through the yearly rule.
  const row = (await db.query('SELECT id FROM tech_phase_billing_sandbox.subscriptions LIMIT 1')).rows[0];
  assert.ok(row);
  await assert.rejects(db.query("UPDATE tech_phase_billing_sandbox.periods SET period_end=period_start + interval '60 days'"), /check constraint/);
  await assert.rejects(db.query("UPDATE tech_phase_billing_sandbox.periods SET period_end=period_start + interval '400 days'"), /check constraint/);
  await assert.rejects(db.query("INSERT INTO tech_phase_billing_sandbox.subscriptions(id,user_id,currency,minor,terms_version) VALUES (gen_random_uuid(),'x','JPY',12345,'v')"), /check constraint/);
  await db.exec(readFileSync(new URL('../db/tech-phase/008_yearly_plans.sql', import.meta.url), 'utf8')); // reapplying is safe
}));
