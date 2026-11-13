/** Explicit one-time operator job. Never exposed through HTTP, API startup or any worker.
 * `db/resolute/020_mail_sender_permissions.sql` creates resolute_notification_sender as NOLOGIN. This job gives that
 * existing role a login password and a fixed search_path, and changes nothing else (no grants, no tables, no other role).
 * It stops unless the role exists, is NOLOGIN, and already has exactly the expected minimum access (checked in a transaction
 * that is always rolled back). The password comes from the environment and is never printed or generated.
 */
import pg from 'pg';
import {pathToFileURL} from 'node:url';
const HEX64 = /^[a-f0-9]{64}$/;
const ROLE = 'resolute_notification_sender';

async function expectDenied(client, name, sql) {
  await client.query('SAVEPOINT denied');
  let denied = false;
  try { await client.query(sql); } catch { denied = true; }
  await client.query('ROLLBACK TO SAVEPOINT denied');
  if (!denied) throw Error(`Sender role unexpectedly permits ${name}`);
}

/** Rolled-back access check. Run before and after enabling login. */
export async function verifySenderAccess(client) {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${ROLE}`);
    for (const sql of ['SELECT 1 FROM resolute.plans LIMIT 1', 'SELECT 1 FROM resolute.notification_settings LIMIT 1',
      'SELECT 1 FROM resolute.notification_outbox LIMIT 1 FOR UPDATE', 'SELECT 1 FROM resolute_payments_live.entitlement_periods LIMIT 1',
      "UPDATE resolute.notification_outbox SET payload = payload, accepted_at = accepted_at WHERE idempotency_key = 'probe'"]) await client.query(sql);
    for (const [name, sql] of [
      ['outbox-insert', "INSERT INTO resolute.notification_outbox(idempotency_key,clerk_user_id,kind,delivery_date_jst,payload) VALUES('x','user_probe','alerts','2000-01-03','{}')"],
      ['outbox-delete', 'DELETE FROM resolute.notification_outbox'],
      ['outbox-key', "UPDATE resolute.notification_outbox SET idempotency_key = 'x'"],
      ['settings-write', 'UPDATE resolute.notification_settings SET revision = revision'],
      ['plans-write', 'UPDATE resolute.plans SET revision = revision'],
      ['state-read', 'SELECT 1 FROM resolute.notification_state LIMIT 1'],
      ['payments-write', 'DELETE FROM resolute_payments_live.entitlement_periods'],
      ['truncate', 'TRUNCATE resolute.notification_outbox'],
      ['ddl', 'CREATE TABLE resolute.sender_probe (a int)'],
    ]) await expectDenied(client, name, sql);
  } finally { await client.query('ROLLBACK'); }
}

export async function enableMailSenderLogin(client, password) {
  if (!HEX64.test(password)) throw Error('Invalid setup scope');
  const role = await client.query('SELECT rolcanlogin, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = $1', [ROLE]);
  if (role.rowCount !== 1) throw Error('Role missing: apply 020 first');
  const r = role.rows[0];
  if (r.rolcanlogin) throw Error('Login already enabled: inspect before running again');
  if (r.rolsuper || r.rolcreaterole || r.rolcreatedb) throw Error('Role has unexpected attributes');
  await verifySenderAccess(client); // the exact minimum, before any change
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(7180433)');
    await client.query(`ALTER ROLE ${ROLE} LOGIN PASSWORD '${password}'`);
    await client.query(`GRANT CONNECT ON DATABASE resolute TO ${ROLE}`);
    await client.query(`ALTER ROLE ${ROLE} IN DATABASE resolute SET search_path = resolute`);
    await client.query(`ALTER ROLE ${ROLE} IN DATABASE resolute SET statement_timeout = 5000`);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  await verifySenderAccess(client); // unchanged after enabling
}

async function verifyLogin(url, password) {
  const login = new URL(url); login.username = ROLE; login.password = password;
  const client = new pg.Client({connectionString: login.toString(), ssl: false, connectionTimeoutMillis: 10000});
  try {
    await client.connect();
    const row = (await client.query("SELECT current_user, current_database(), current_setting('search_path') AS search_path")).rows[0];
    if (row.current_user !== ROLE || row.current_database !== 'resolute' || row.search_path !== 'resolute') throw Error('Login verification failed');
  } finally { await client.end(); }
}

export async function main(env = process.env) {
  if (env.RESOLUTE_ENABLE_MAIL_SENDER_LOGIN !== 'true') return {event: 'RESOLUTE_MAIL_SENDER_LOGIN_DISABLED'};
  const url = new URL(env.RESOLUTE_SETUP_DB_URL);
  const password = env.RESOLUTE_NOTIFICATION_SENDER_PASSWORD ?? '';
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== 'postgres.railway.internal' || url.pathname !== '/resolute' || !HEX64.test(password)) throw Error('Invalid setup scope');
  const client = new pg.Client({connectionString: url.toString(), ssl: false, connectionTimeoutMillis: 10000, statement_timeout: 10000, query_timeout: 15000});
  try {
    await client.connect();
    await enableMailSenderLogin(client, password);
  } finally { await client.end(); }
  await verifyLogin(url.toString(), password);
  return {event: 'RESOLUTE_MAIL_SENDER_LOGIN_OK', database: 'resolute', role: ROLE,
    checks: ['role-existed-nologin', 'minimum-access-before', 'login-enabled', 'minimum-access-after', 'login', 'probes-rolled-back']};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(r => console.log(JSON.stringify(r))).catch(() => { console.error('RESOLUTE_MAIL_SENDER_LOGIN_FAILED'); process.exitCode = 1; });
}
