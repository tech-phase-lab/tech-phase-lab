import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { billingStore } from '../services/tech-phase-billing/store.mjs';
import { checkoutService } from '../services/tech-phase-billing/checkout.mjs';
import { reconciliationService, monthlyBoundary } from '../services/tech-phase-billing/settlement.mjs';
import { webhookService } from '../services/tech-phase-billing/webhook.mjs';
import { billingGateway, billingBackend } from '../services/tech-phase-billing/transport.mjs';
import { sandboxMemberAllowed } from '../services/tech-phase-billing/access.mjs';
import { inspectSandboxLedger } from '../services/tech-phase-billing/inspect-ledger.mjs';

// Real gateway, backend, checkout, settlement and SQL; only PayPal and identity
// are fixtures. No network fetch, real credentials or persistent database.
test('two enrolled members remain isolated through checkout, webhook replay and refund', async () => {
  const db = new PGlite();
  try {
    for (const name of ['001_billing_sandbox.sql', '002_paid_periods_sandbox.sql', '003_provider_billing_clock.sql', '004_dispute_holds_sandbox.sql']) {
      await db.exec(readFileSync(new URL('../db/tech-phase/' + name, import.meta.url), 'utf8'));
    }
    const store = billingStore({query: (...args) => db.query(...args), connect: async () => ({query: (...args) => db.query(...args), release() {}})});
    const owner = 'user_owner', member = 'user_Member2';
    const origin = 'https://preview.test';
    const env = {VERCEL_ENV: 'preview', TECH_PHASE_PAYPAL_ENV: 'sandbox', TECH_PHASE_BILLING_SANDBOX_ENABLED: 'true',
      TECH_PHASE_BILLING_SANDBOX_WEBHOOK_ENABLED: 'true', TECH_PHASE_BILLING_SANDBOX_TEST_USERS: JSON.stringify([member]),
      TECH_PHASE_BILLING_SERVICE_TOKEN: 'offline_fixture_'.repeat(4), TECH_PHASE_BILLING_SERVICE_URL: 'https://fixture.up.railway.app',
      TECH_PHASE_BILLING_RUNTIME: 'railway-sandbox', RAILWAY_GIT_BRANCH: 'codex/research-preview'};
    const plans = {JPY: 'P-' + 'J'.repeat(24), USD: 'P-' + 'U'.repeat(24)};
    const contracts = new Map();
    let identity = owner, validSignature = true, creations = 0;
    const paypal = {
      async create({id, currency}) {
        creations++;
        const providerId = currency === 'JPY' ? 'I-JPYAAAAAAAAA' : 'I-USDAAAAAAAAA';
        const start = new Date(Date.now() - 1000).toISOString();
        const amount = {currency_code: currency, value: currency === 'JPY' ? '2980' : '20.00'};
        contracts.set(providerId, {id: providerId, custom_id: id, plan_id: plans[currency], status: 'ACTIVE', start_time: start,
          billing_info: {last_payment: {amount, time: start}, outstanding_balance: {currency_code: currency, value: '0'},
            failed_payments_count: 0, next_billing_time: monthlyBoundary(start, 1),
            cycle_executions: [{tenure_type: 'REGULAR', sequence: 1, cycles_completed: 1}]}});
        return {id: providerId, approvalUrl: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-ABCDEFGHIJKL'};
      },
      async get(id) { assert.ok(contracts.has(id)); return contracts.get(id); },
      async transactions(id) {
        const row = contracts.get(id);
        return {transactions: [{id: 'TX-' + row.billing_info.last_payment.amount.currency_code, status: 'COMPLETED',
          time: row.start_time, amount_with_breakdown: {gross_amount: row.billing_info.last_payment.amount}}]};
      },
      async verify() { return validSignature; },
    };
    const reconciliation = reconciliationService({store, paypal, plans});
    const services = {store, reconciliation, checkout: checkoutService({store, paypal, termsVersion: 'sandbox-v1'}),
      webhook: webhookService({store, paypal, reconciliation, ownerId: owner, allowedUser: id => sandboxMemberAllowed(env, owner, id)})};
    const backend = billingBackend({env, ownerId: owner, services: async () => services});
    const gateway = billingGateway({env, ownerId: owner, identity: async () => identity,
      fetcher: (url, options) => backend(new Request(url, options))});
    async function call(action, body, expected = 200) {
      const response = await gateway(new Request(origin + '/api/' + action, {
        method: body ? 'POST' : 'GET', headers: {origin, 'content-type': 'application/json', 'x-tech-phase-user': owner},
        ...(body ? {body: JSON.stringify(body)} : {}),
      }), action);
      assert.equal(response.status, expected, action);
      return response.json();
    }
    async function notify(event, expected = 200) {
      const response = await backend(new Request('https://fixture.up.railway.app/webhooks/paypal/sandbox', {
        method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(event),
      }));
      assert.equal(response.status, expected);
      return response.json();
    }
    const first = await call('create', {currency: 'JPY', acceptedTerms: 'sandbox-v1'});
    identity = member;
    const second = await call('create', {currency: 'USD', acceptedTerms: 'sandbox-v1'});
    assert.notEqual(first.id, second.id);
    assert.equal((await call('status')).plan, 'free', 'provider ACTIVE alone must not grant access');
    await call('reconcile', {id: first.id}, 404);
    await call('cancel', {id: first.id}, 404);
    for (const id of contracts.keys()) {
      const event = {id: 'WH-' + id, event_type: 'PAYMENT.SALE.COMPLETED', resource: {billing_agreement_id: id, user_id: 'user_Forged'}};
      assert.equal((await notify(event)).status, 'verified');
      assert.equal((await notify(event)).status, 'verified');
    }
    assert.equal((await call('status')).subscription.id, second.id);
    assert.equal((await call('status')).plan, 'pro');
    identity = owner;
    const before = await call('status');
    assert.equal(before.subscription.id, first.id);
    assert.equal(before.plan, 'pro');
    const refund = {id: 'WH-USD-REFUND', event_type: 'PAYMENT.SALE.REFUNDED', resource: {sale_id: 'TX-USD'}};
    validSignature = false;
    await notify(refund, 401);
    identity = member;
    assert.equal((await call('status')).plan, 'pro');
    validSignature = true;
    for (let n = 0; n < 2; n++) assert.equal((await notify(refund)).status, 'review-required');
    const held = await call('status');
    assert.equal(held.plan, 'free');
    assert.equal(held.reviewRequired, true);
    await notify({id: 'WH-USD-LATE', event_type: 'PAYMENT.SALE.COMPLETED', resource: {billing_agreement_id: 'I-USDAAAAAAAAA'}});
    assert.deepEqual(await call('status'), held, 'late completion must not undo a refund');
    identity = owner;
    assert.deepEqual(await call('status'), before, 'other member refund must not change owner access');
    identity = 'user_NotEnrolled';
    await call('status', undefined, 403);
    assert.equal(creations, 2);
    let released = 0, snapshots = 0;
    const report = await inspectSandboxLedger({connect: async () => ({
      async query(...args) {
        const result = await db.query(...args);
        if (args[0].startsWith('BEGIN')) {
          const settings = (await db.query("SELECT current_setting('transaction_read_only') AS ro, current_setting('transaction_isolation') AS isolation")).rows[0];
          assert.equal(settings.ro, 'on');
          assert.equal(settings.isolation, 'repeatable read');
          snapshots++;
        }
        return result;
      }, release() { released++; },
    })}, [owner, member]);
    assert.equal(snapshots, 1);
    assert.equal(released, 1);
    assert.equal(report.providerCompared, false);
    assert.equal(report.members[0].plan, 'pro');
    assert.equal(report.members[0].proExpiresAt, before.proExpiresAt);
    assert.equal(report.members[1].plan, 'free');
    assert.equal(report.members[1].reviewRequired, true);
    assert.deepEqual(report.members[1].contracts[0], {currency: 'USD', state: 'active', paymentCount: 1,
      periodCount: 1, mismatchedPayments: 0, holdReasons: ['REFUNDED'], adverseReasons: ['REFUNDED']});
    const serialized = JSON.stringify(report);
    for (const secret of [owner, member, first.id, second.id, 'I-USDAAAAAAAAA', 'TX-USD', env.TECH_PHASE_BILLING_SERVICE_TOKEN]) {
      assert.equal(serialized.includes(secret), false, 'inspection must redact identifiers');
    }
    for (const table of ['payments', 'periods', 'events']) {
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.${table}`)).rows[0].n, 2, table);
    }
  } finally { await db.close(); }
});

test('ledger inspection validates its cohort before connecting and masks connection/query failures', async () => {
  let connections = 0, releases = 0;
  const calls = [];
  const pool = {async connect() {
    connections++;
    return {query: async sql => { calls.push(sql); if (sql.startsWith('WITH')) throw Error('private-db-detail'); return {rows: []}; },
      release() { releases++; }};
  }};
  for (const members of [[], ['user_A'], ['user_A', 'user_A'], ['user_A', 'user_B', 'user_C'], ['user_A', '../invalid']]) {
    await assert.rejects(inspectSandboxLedger(pool, members), {message: 'INVALID_INSPECTION'});
  }
  await assert.rejects(inspectSandboxLedger(pool, ['user_A', 'user_B'], Infinity), {message: 'INVALID_INSPECTION'});
  assert.equal(connections, 0);
  await assert.rejects(inspectSandboxLedger(pool, ['user_A', 'user_B']), {message: 'LEDGER_INSPECTION_UNAVAILABLE'});
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(releases, 1);
  await assert.rejects(inspectSandboxLedger({connect: async () => { throw Error('postgres://private'); }}, ['user_A', 'user_B']),
    {message: 'LEDGER_INSPECTION_UNAVAILABLE'});
});

test('ledger inspection rejects partial reports and discards a connection when rollback fails', async () => {
  for (const scenario of ['second-member', 'limit', 'rollback', 'release']) {
    let released = 0, releaseError, summaries = 0;
    const calls = [];
    const client = {
      async query(sql) {
        calls.push(sql);
        if (sql.startsWith('WITH')) {
          summaries++;
          if (scenario === 'second-member' && summaries === 2) throw Error('private-member-record');
          return {rows: [{until: null, review_required: false}]};
        }
        if (sql.startsWith('SELECT s.currency')) return {rows: scenario === 'limit' ? Array(101).fill({}) : []};
        if (sql === 'ROLLBACK' && scenario === 'rollback') throw Error('private-connection-info');
        return {rows: []};
      },
      release(error) { released++; releaseError = error; if (scenario === 'release') throw Error('private-pool-detail'); },
    };
    await assert.rejects(inspectSandboxLedger({connect: async () => client}, ['user_A', 'user_B']),
      {message: 'LEDGER_INSPECTION_UNAVAILABLE'}, scenario);
    assert.equal(calls.at(-1), 'ROLLBACK');
    assert.equal(released, 1);
    assert.equal(Boolean(releaseError), scenario === 'rollback');
    if (releaseError) assert.equal(releaseError.message, 'LEDGER_INSPECTION_UNAVAILABLE');
  }
});

test('ledger inspection freezes the validated member selection while awaiting a connection', async () => {
  const members = ['user_A', 'user_B'], seen = [];
  const report = await inspectSandboxLedger({async connect() {
    members[1] = 'user_Unrequested';
    return {
      async query(sql, values) {
        if (sql.startsWith('WITH')) { seen.push(values[0]); return {rows: [{until: null, review_required: false}]}; }
        return {rows: []};
      }, release() {},
    };
  }}, members);
  assert.deepEqual(seen, ['user_A', 'user_B']);
  assert.equal(report.members.length, 2);
  assert.ok(report.members.every(member => member.plan === 'free' && member.contracts.length === 0));
});
