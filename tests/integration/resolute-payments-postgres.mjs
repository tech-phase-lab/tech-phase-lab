import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { paymentStore } from '../../services/resolute-api/payments/store.mjs';
import { quote, identity } from '../../services/resolute-api/payments/policy.mjs';

// Explicitly invoked against a disposable local PostgreSQL database only.
const url = new URL(process.env.RESOLUTE_TEST_POSTGRES_URL ?? '');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.equal(url.pathname, '/resolute');
const pool = new Pool({ connectionString: url.href, max: 12 });
const store = paymentStore(pool);
const now = Date.parse('2026-10-15T06:00:00Z');
let created = false;
const member = id => identity({ id, primaryEmailAddressId: 'email_test',
  emailAddresses: [{ id: 'email_test', verification: { status: 'verified' } }], privateMetadata: {} }, now);
async function order(id, key = randomUUID(), kind = 'initial') {
  return store.create(id, key, rights => quote(kind, 'ja', member(id), rights, now), now);
}
async function ready(id, kind = 'initial') {
  let o = await order(id, randomUUID(), kind);
  o = await store.bind(o, randomUUID().replaceAll('-', '').toUpperCase());
  return store.prepare(o, member(id), now, () => {});
}
const payment = () => ({ captureId: randomUUID(), paidAt: new Date(now + 1000).toISOString() });
async function grants(id) {
  return (await pool.query('SELECT * FROM resolute_payments_sandbox.grants WHERE user_id=$1 ORDER BY starts_at', [id])).rows;
}

test.before(async () => {
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")).rows[0].n, 0,
    'Refusing to use a database that already contains application tables');
  await pool.query(await readFile(new URL('../../db/resolute/010_payments_sandbox.sql', import.meta.url), 'utf8'));
  created = true;
  const connections = await Promise.all(Array.from({ length: 4 }, () => pool.connect()));
  try {
    const sessions = await Promise.all(connections.map(db => db.query('SELECT pg_backend_pid() AS pid')));
    assert.equal(new Set(sessions.map(r => r.rows[0].pid)).size, 4);
  } finally { connections.forEach(db => db.release()); }
});
test.after(async () => {
  if (created) await pool.query('DROP SCHEMA resolute_payments_sandbox CASCADE');
  await pool.end();
});

test('concurrent retries create one order and one audit record', async () => {
  const key = randomUUID(), id = 'user_retry';
  const results = await Promise.all(Array.from({ length: 10 }, () => order(id, key)));
  assert.equal(new Set(results.map(o => o.id)).size, 1);
  const audits = await pool.query("SELECT count(*)::int AS n FROM resolute_payments_sandbox.audit WHERE order_id=$1 AND code='ORDER_CREATED'", [results[0].id]);
  assert.equal(audits.rows[0].n, 1);
});

test('concurrent completion delivery grants exactly once', async () => {
  const o = await ready('user_complete'), p = payment();
  const results = await Promise.all(Array.from({ length: 10 }, () => store.paid(o, p)));
  assert.equal(results.filter(r => r === 'paid').length, 1);
  assert.equal(results.filter(r => r === 'already-paid').length, 9);
  assert.equal((await grants(o.user_id)).length, 1);
});

test('two orders cannot both capture for the same member', async () => {
  const id = 'user_capture';
  const originals = await Promise.all([order(id), order(id)]);
  const bound = await Promise.all(originals.map(o => store.bind(o, randomUUID().replaceAll('-', '').toUpperCase())));
  const results = await Promise.allSettled(bound.map(o => store.prepare(o, member(id), now, () => {})));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, '23505');
});

test('refund racing completion cannot leave an active grant or duplicate refund alert', async () => {
  for (let i = 0; i < 12; i++) {
    const o = await ready(`user_refund${i}`), p = payment();
    const complete = () => store.paid(o, p);
    const refund = () => store.adverse(o.paypal_id, 'revoked', 'PAYMENT.CAPTURE.REFUNDED', `refund-${i}`);
    await Promise.all(i % 2 ? [refund(), complete(), refund()] : [complete(), refund(), refund()]);
    await store.paid(o, p);
    assert.equal((await store.get(o.id)).state, 'revoked');
    assert.ok((await grants(o.user_id)).every(g => g.state === 'revoked'));
    const alerts = await pool.query('SELECT count(*)::int AS n FROM resolute_payments_sandbox.alert_outbox x JOIN resolute_payments_sandbox.audit a ON a.id=x.audit_id WHERE a.order_id=$1', [o.id]);
    assert.equal(alerts.rows[0].n, 1);
  }
});

test('duplicate renewal completion extends once, from the existing expiry', async () => {
  const id = 'user_renewal', initial = await ready(id);
  await store.paid(initial, payment());
  const previous = (await grants(id))[0], renewal = await ready(id, 'renewal'), p = payment();
  await Promise.all(Array.from({ length: 10 }, () => store.paid(renewal, p)));
  const rows = await grants(id);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].starts_at.toISOString(), previous.expires_at.toISOString());
  assert.equal(rows[1].expires_at.toISOString(), '2028-10-15T06:00:01.000Z');
});
