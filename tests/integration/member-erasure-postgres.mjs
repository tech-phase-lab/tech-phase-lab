import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

// Explicitly invoked against a disposable, empty local PostgreSQL database named "resolute" only:
//   MEMBER_ERASURE_TEST_POSTGRES_URL=postgresql://postgres@127.0.0.1:55433/resolute MEMBER_ERASURE_TEST_DISPOSABLE=true \
//   node --test tests/integration/member-erasure-postgres.mjs
// It creates NOLOGIN roles the migrations grant to, applies the RESOLUTE and PRO billing migrations and checks
// db/resolute/026_member_erasure.sql and db/tech-phase/009_member_erasure.sql.
const url = new URL(process.env.MEMBER_ERASURE_TEST_POSTGRES_URL ?? '');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.equal(url.pathname, '/resolute');
assert.equal(process.env.MEMBER_ERASURE_TEST_DISPOSABLE, 'true');
const pool = new Pool({ connectionString: url.href, max: 4 });
const sql = name => readFile(new URL(`../../db/${name}`, import.meta.url), 'utf8');
const OWNERS = ['user_3JulL4D07KtVl5Eg2zdY1iczKbC', 'user_3LHR1K8f8zwyDcVzMg7ud6KB9Wb'];
const q = async (text, args) => (await pool.query(text, args)).rows;

test.before(async () => {
  assert.equal((await q("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')"))[0].n, 0,
    'Refusing to use a database that already contains application tables');
  for (const role of ['resolute_plan_writer', 'resolute_notification_writer', 'tech_phase_billing_live_writer', 'resolute_member_erasure', 'tech_phase_member_erasure'])
    await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
  for (const name of ['001_entitlements', '002_plans', '003_plan_answers_fx', '004_notification_settings', '005_notification_outbox', '010_payments_sandbox',
    '014_payments_live', '017_notification_suppressions', '018_protection_outbox', '021_guest_payments', '022_guest_receipt_queue', '025_auto_renewal', '026_member_erasure'])
    await pool.query(await sql(`resolute/${name}.sql`));
  for (const name of ['005_billing_live', '006_live_recovery', '007_billing_security', '008_yearly_plans', '009_member_erasure'])
    await pool.query(await sql(`tech-phase/${name}.sql`));
  // Idempotent re-application.
  await pool.query(await sql('resolute/026_member_erasure.sql'));
  await pool.query(await sql('tech-phase/009_member_erasure.sql'));
});
test.after(async () => { await pool.end(); });

async function seedResolute(user, renewalState = 'stopped') {
  const order = randomUUID(), at = '2026-03-10T00:00:00Z';
  await pool.query(`INSERT INTO resolute.entitlements VALUES ($1,'resolute_v1','use',$2,NULL,NULL,'purchase',now(),now())`, [user, at]);
  await pool.query(`INSERT INTO resolute.plans VALUES ($1,1,'{"answersVersion":1,"answers":{},"fx":{}}',now(),now(),NULL)`, [user]);
  await pool.query(`INSERT INTO resolute.notification_settings VALUES ($1,'{"deliveryHourJst":"8","morningEnabled":true,"alertsEnabled":true,"watchItems":[]}',1,now())`, [user]);
  await pool.query(`INSERT INTO resolute.notification_outbox VALUES ($1,$2,'alerts','2026-11-01','{}',now(),NULL)`, [randomUUID(), user]);
  await pool.query(`INSERT INTO resolute_payments_live.orders(id,user_id,request_key,capture_key,quote,paypal_id,capture_id,state,created_at,expires_at,paid_at)
    VALUES ($1,$2,$3,$4,'{"kind":"initial","product":"resolute_v1"}',$5,$6,'paid',$7,$7::timestamptz + interval '1 hour',$7)`,
  [order, user, randomUUID(), randomUUID(), 'P' + order.slice(0, 8), 'C' + order.slice(0, 8), at]);
  await pool.query(`INSERT INTO resolute_payments_live.grants VALUES ($1,$2,'initial',$3,$3::timestamptz + interval '1 year','active')`, [order, user, at]);
  await pool.query(`INSERT INTO resolute_payments_live.renewal_plans(user_id,source_order_id,token_id,language,state,consent_at,consent_version,next_renewal_at)
    VALUES ($1,$2,$3,'ja',$4,now(),'v1',now() + interval '1 year')`, [user, order, 'tok' + order.slice(0, 8), renewalState]);
  return order;
}

async function seedBilling(user, state = 'cancelled') {
  const id = randomUUID(), tx = 'TX' + id.slice(0, 8);
  await pool.query(`INSERT INTO tech_phase_billing_live.subscriptions(id,user_id,currency,minor,terms_version,paypal_id,state)
    VALUES ($1,$2,'JPY',2980,'2026-10',$3,$4)`, [id, user, 'I-' + id.slice(0, 8), state]);
  await pool.query(`INSERT INTO tech_phase_billing_live.payments VALUES ($1,$2,'JPY',2980,'2026-04-01T00:00:00Z',now())`, [tx, id]);
  await pool.query(`INSERT INTO tech_phase_billing_live.periods VALUES ($1,'2026-04-01T00:00:00Z','2026-05-01T00:00:00Z',now())`, [tx]);
  // An abandoned checkout that never reached PayPal (removed by the erasure).
  if (state === 'cancelled')
    await pool.query(`INSERT INTO tech_phase_billing_live.subscriptions(id,user_id,currency,minor,terms_version,state) VALUES ($1,$2,'JPY',2980,'2026-10','creating')`, [randomUUID(), user]);
  return { id, tx };
}

test('owner accounts are refused by both erasure functions', async () => {
  for (const owner of OWNERS) {
    await seedResolute(owner);
    await seedBilling(owner);
    await assert.rejects(pool.query('SELECT resolute.erase_member($1)', [owner]), /owner-account/);
    await assert.rejects(pool.query('SELECT tech_phase_billing_live.erase_member($1)', [owner]), /owner-account/);
    assert.equal((await q('SELECT count(*)::int AS n FROM resolute.plans WHERE clerk_user_id=$1 AND plan IS NOT NULL', [owner]))[0].n, 1);
    assert.equal((await q('SELECT count(*)::int AS n FROM tech_phase_billing_live.subscriptions WHERE user_id=$1', [owner]))[0].n, 2);
  }
  // The purge never touches live identities either.
  await pool.query('SELECT resolute.purge_expired($1)', ['2099-01-01T00:00:00Z']);
  await pool.query('SELECT tech_phase_billing_live.purge_expired($1)', ['2099-01-01T00:00:00Z']);
  assert.equal((await q('SELECT count(*)::int AS n FROM resolute_payments_live.orders WHERE user_id = ANY($1)', [OWNERS]))[0].n, 2);
  assert.equal((await q('SELECT count(*)::int AS n FROM tech_phase_billing_live.payments p JOIN tech_phase_billing_live.subscriptions s ON s.id=p.subscription_id WHERE s.user_id = ANY($1)', [OWNERS]))[0].n, 2);
});

test('RESOLUTE: settings removed with tombstones, payments kept but detached, purged after retention', async () => {
  const user = 'user_departedResolute1', order = await seedResolute(user);
  assert.equal((await q('SELECT resolute.erase_member($1) AS r', [user]))[0].r, 'erased');
  for (const table of ['entitlements', 'notification_settings', 'notification_outbox'])
    assert.equal((await q(`SELECT count(*)::int AS n FROM resolute.${table} WHERE clerk_user_id=$1`, [user]))[0].n, 0, table);
  assert.equal((await q('SELECT plan FROM resolute.plans WHERE clerk_user_id=$1', [user]))[0].plan, null);
  const kinds = (await q('SELECT kind FROM resolute.protection_outbox WHERE clerk_user_id=$1 ORDER BY kind', [user])).map(r => r.kind);
  assert.deepEqual(kinds, ['alerts_off', 'delete', 'morning_off']);
  assert.equal((await q('SELECT count(*)::int AS n FROM resolute_payments_live.renewal_plans WHERE source_order_id=$1', [order]))[0].n, 0);
  const kept = await q('SELECT o.user_id, g.user_id AS grant_user, o.paid_at FROM resolute_payments_live.orders o JOIN resolute_payments_live.grants g ON g.order_id=o.id WHERE o.id=$1', [order]);
  assert.match(kept[0].user_id, /^user_erased[a-f0-9]{32}$/);
  assert.equal(kept[0].grant_user, kept[0].user_id);
  const [{ retain_until }] = await q('SELECT retain_until FROM resolute.member_erasures WHERE pseudonym=$1', [kept[0].user_id]);
  assert.equal(retain_until.toISOString(), '2034-06-30T15:00:00.000Z'); // 1 July 2034 JST: tax year 2026 + filing + 7 years
  await pool.query('SELECT resolute.purge_expired($1)', ['2034-06-01T00:00:00Z']);
  assert.equal((await q('SELECT count(*)::int AS n FROM resolute_payments_live.orders WHERE id=$1', [order]))[0].n, 1);
  const purged = (await q('SELECT resolute.purge_expired($1) AS r', ['2034-07-02T00:00:00Z']))[0].r;
  assert.equal(purged.erasedMembersPurged, 1);
  assert.equal((await q('SELECT count(*)::int AS n FROM resolute_payments_live.orders WHERE id=$1', [order]))[0].n, 0);
});

test('RESOLUTE: an active auto-renewal blocks erasure until it is stopped', async () => {
  const user = 'user_renewingMember1';
  await seedResolute(user, 'active');
  await assert.rejects(pool.query('SELECT resolute.erase_member($1)', [user]), /open-renewal/);
  assert.equal((await q('SELECT count(*)::int AS n FROM resolute.plans WHERE clerk_user_id=$1 AND plan IS NOT NULL', [user]))[0].n, 1);
});

test('PRO billing: open contract blocks; closed contracts are detached and purged after retention', async () => {
  const open = 'user_openContract1';
  await seedBilling(open, 'active');
  await assert.rejects(pool.query('SELECT tech_phase_billing_live.erase_member($1)', [open]), /open-contract/);
  const user = 'user_departedPro1', { id, tx } = await seedBilling(user);
  assert.equal((await q('SELECT tech_phase_billing_live.erase_member($1) AS r', [user]))[0].r, 'erased');
  assert.equal((await q('SELECT count(*)::int AS n FROM tech_phase_billing_live.subscriptions WHERE user_id=$1', [user]))[0].n, 0);
  const [{ user_id }] = await q('SELECT user_id FROM tech_phase_billing_live.subscriptions WHERE id=$1', [id]);
  assert.match(user_id, /^user_erased[a-f0-9]{32}$/);
  assert.equal((await q('SELECT count(*)::int AS n FROM tech_phase_billing_live.payments WHERE transaction_id=$1', [tx]))[0].n, 1);
  assert.equal((await q('SELECT tech_phase_billing_live.erase_member($1) AS r', [user]))[0].r, 'nothing-to-erase');
  await pool.query(`INSERT INTO tech_phase_billing_live.security_windows VALUES ($1,'attempt','2026-01-01T00:00:00Z',1)`, ['a'.repeat(64)]);
  const purged = (await q('SELECT tech_phase_billing_live.purge_expired($1) AS r', ['2035-01-01T00:00:00Z']))[0].r;
  assert.equal(purged.securityWindows, 1);
  assert.equal(purged.erasedMembersPurged, 1);
  assert.equal((await q('SELECT count(*)::int AS n FROM tech_phase_billing_live.subscriptions WHERE id=$1', [id]))[0].n, 0);
});

test('the erasure roles can only execute the functions', async () => {
  for (const [role, schema] of [['resolute_member_erasure', 'resolute'], ['tech_phase_member_erasure', 'tech_phase_billing_live']]) {
    const rows = await q(`SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE grantee=$1`, [role]);
    assert.equal(rows[0].n, 0);
    assert.equal((await q(`SELECT has_function_privilege($1, $2 || '.erase_member(text)', 'EXECUTE') AS ok`, [role, schema]))[0].ok, true);
  }
});
