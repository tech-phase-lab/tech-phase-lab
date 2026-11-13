/** Explicit one-time operator job. Never exposed through HTTP, API startup or any worker.
 * Creates ONE dedicated login role in the `resolute` database for the notification queue cron step:
 *   resolute_notification_queue
 *     USAGE on schemas resolute and resolute_payments_live
 *     SELECT on resolute.plans, resolute.notification_settings, resolute.entitlements,
 *            resolute_payments_live.entitlement_periods
 *     SELECT/INSERT/UPDATE on resolute.notification_state
 *     SELECT/INSERT on resolute.notification_outbox, plus UPDATE(payload) only
 * It creates no tables and changes no other role. It stops if the role already exists or a required table is missing.
 * The password is supplied through the environment; this script never prints or generates it.
 * Verification runs inside one transaction that is always rolled back.
 */
import pg from 'pg';
import {pathToFileURL} from 'node:url';
const HEX64 = /^[a-f0-9]{64}$/;
const ROLE = 'resolute_notification_queue';
const REQUIRED = ['resolute.plans', 'resolute.notification_settings', 'resolute.entitlements', 'resolute.notification_state', 'resolute.notification_outbox', 'resolute_payments_live.entitlement_periods'];

export async function provisionNotificationQueue(client, password) {
  if (!HEX64.test(password)) throw Error('Invalid setup scope');
  const roles = await client.query('SELECT rolname FROM pg_roles WHERE rolname = $1', [ROLE]);
  if (roles.rowCount) throw Error('Role already exists: inspect before running again');
  for (const name of REQUIRED) {
    const found = await client.query('SELECT to_regclass($1) AS table_name', [name]);
    if (!found.rows[0].table_name) throw Error('Required table missing');
  }
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(7180432)');
    await client.query(`CREATE ROLE ${ROLE} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
    await client.query(`GRANT CONNECT ON DATABASE resolute TO ${ROLE}`);
    await client.query(`GRANT USAGE ON SCHEMA resolute, resolute_payments_live TO ${ROLE}`);
    await client.query(`ALTER ROLE ${ROLE} IN DATABASE resolute SET search_path = resolute`);
    await client.query(`ALTER ROLE ${ROLE} IN DATABASE resolute SET statement_timeout = 5000`);
    await client.query(`GRANT SELECT ON resolute.plans, resolute.notification_settings, resolute.entitlements, resolute_payments_live.entitlement_periods TO ${ROLE}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE ON resolute.notification_state TO ${ROLE}`);
    await client.query(`GRANT SELECT, INSERT ON resolute.notification_outbox TO ${ROLE}`);
    await client.query(`GRANT UPDATE (payload) ON resolute.notification_outbox TO ${ROLE}`);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  // Always rolled back: nothing is left behind.
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${ROLE}`);
    for (const sql of [
      'SELECT 1 FROM resolute.plans LIMIT 1', 'SELECT 1 FROM resolute.notification_settings LIMIT 1', 'SELECT 1 FROM resolute.entitlements LIMIT 1',
      'SELECT 1 FROM resolute_payments_live.entitlement_periods LIMIT 1', 'SELECT 1 FROM resolute.notification_state LIMIT 1',
      'SELECT 1 FROM resolute.notification_outbox LIMIT 1 FOR UPDATE',
      "INSERT INTO resolute.notification_state(clerk_user_id,rule_key,notified) VALUES('user_probe','x','{}')",
      "UPDATE resolute.notification_state SET notified='{}' WHERE clerk_user_id='user_probe'",
      "INSERT INTO resolute.notification_outbox(idempotency_key,clerk_user_id,kind,delivery_date_jst,payload) VALUES('user_probe:2000-01-03:alerts','user_probe','alerts','2000-01-03','{}')",
      "UPDATE resolute.notification_outbox SET payload='{}' WHERE clerk_user_id='user_probe'",
    ]) await client.query(sql);
    for (const [name, sql] of [
      ['settings-write', "UPDATE resolute.notification_settings SET revision = revision"],
      ['settings-insert', "INSERT INTO resolute.notification_settings(clerk_user_id) VALUES('user_probe')"],
      ['plans-write', 'UPDATE resolute.plans SET revision = revision'],
      ['entitlements-write', 'DELETE FROM resolute.entitlements'],
      ['outbox-delete', 'DELETE FROM resolute.notification_outbox'],
      ['outbox-accept', 'UPDATE resolute.notification_outbox SET accepted_at = now()'],
      ['outbox-key', "UPDATE resolute.notification_outbox SET idempotency_key = 'x'"],
      ['state-delete', 'DELETE FROM resolute.notification_state'],
      ['payments-write', 'DELETE FROM resolute_payments_live.entitlement_periods'],
      ['truncate', 'TRUNCATE resolute.notification_outbox'],
      ['ddl', 'CREATE TABLE resolute.queue_probe (a int)'],
    ]) {
      await client.query('SAVEPOINT denied');
      let denied = false;
      try { await client.query(sql); } catch { denied = true; }
      await client.query('ROLLBACK TO SAVEPOINT denied');
      if (!denied) throw Error(`Queue role unexpectedly permits ${name}`);
    }
  } finally { await client.query('ROLLBACK'); }
}

async function verifyLogin(url, password) {
  const login = new URL(url); login.username = ROLE; login.password = password;
  const client = new pg.Client({connectionString: login.toString(), ssl: false, connectionTimeoutMillis: 10000});
  try {
    await client.connect();
    const row = (await client.query("SELECT current_user, current_database(), current_setting('search_path') AS search_path, (SELECT count(*)::int FROM resolute.notification_outbox) AS outbox")).rows[0];
    if (row.current_user !== ROLE || row.current_database !== 'resolute' || row.search_path !== 'resolute') throw Error('Login verification failed');
  } finally { await client.end(); }
}

export async function main(env = process.env) {
  if (env.RESOLUTE_PROVISION_NOTIFICATION_QUEUE !== 'true') return {event: 'RESOLUTE_NOTIFICATION_QUEUE_PROVISION_DISABLED'};
  const url = new URL(env.RESOLUTE_SETUP_DB_URL);
  const password = env.RESOLUTE_NOTIFICATION_QUEUE_PASSWORD ?? '';
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== 'postgres.railway.internal' || url.pathname !== '/resolute' || !HEX64.test(password)) throw Error('Invalid setup scope');
  const client = new pg.Client({connectionString: url.toString(), ssl: false, connectionTimeoutMillis: 10000, statement_timeout: 10000, query_timeout: 15000});
  try {
    await client.connect();
    await provisionNotificationQueue(client, password);
  } finally { await client.end(); }
  await verifyLogin(url.toString(), password);
  return {event: 'RESOLUTE_NOTIFICATION_QUEUE_PROVISION_OK', database: 'resolute', role: ROLE,
    checks: ['required-tables-present', 'role-absent-before', 'reads-and-queue-writes-allowed', 'settings-plans-entitlements-payments-writes-denied', 'outbox-delete-accept-key-truncate-ddl-denied', 'login', 'probes-rolled-back']};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(r => console.log(JSON.stringify(r))).catch(() => { console.error('RESOLUTE_NOTIFICATION_QUEUE_PROVISION_FAILED'); process.exitCode = 1; });
}
