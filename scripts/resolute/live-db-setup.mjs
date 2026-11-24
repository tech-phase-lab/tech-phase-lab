/** Explicit one-off operator job for RESOLUTE live sales. Never exposed through HTTP, API startup or any worker.
 * Inert unless RESOLUTE_LIVE_DB_SETUP is exactly `check` or `apply`.
 *
 * check: read-only catalog queries (the session is READ ONLY) reporting, as booleans, whether the objects of the live
 *        payment migrations exist on the dedicated `resolute` database: 015 (live writer role), 016 (entitlement view
 *        grants to the three consumer roles), 021 (orders.guest_id), 022 (guest_receipts), 023 (guest receipt sender
 *        role), 025 (renewal_plans and the writer's INSERT grant), plus whether the two roles can log in.
 * apply: applies only the missing migrations, in the order 015 → 016 → 021 → 022 → 023 → 025 (025 always runs; it is
 *        re-runnable), each in its own transaction with short lock/statement timeouts. Then it sets the live writer's
 *        login password from RESOLUTE_PAYMENT_LIVE_DB_PASSWORD (it must equal the password inside the API's
 *        RESOLUTE_PAYMENT_LIVE_DB_URL), and gives the guest receipt sender a login from RESOLUTE_GUEST_RECEIPT_DB_PASSWORD
 *        only while that role is NOLOGIN. Finally it re-runs the check.
 *
 * The connection comes from RESOLUTE_SETUP_DB_URL: host postgres.railway.internal, database /resolute, an admin user
 * (not one of the scoped resolute_* application roles; the role must be superuser or CREATEROLE).
 * Output is one JSON line of names and booleans: never a URL, password or row data.
 */
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {liveConfigSelfCheck} from '../../services/resolute-api/payments/live-config-check.mjs';

const HEX64 = /^[a-f0-9]{64}$/;
const S = 'resolute_payments_live';
const WRITER = 'resolute_payment_live_writer';
const SENDER = 'resolute_guest_mail_sender';
const CONSUMERS = ['resolute_api_reader', 'resolute_plan_writer', 'resolute_notification_writer'];
/** Order matters: each later migration depends on the earlier ones. */
export const MIGRATIONS = [
  ['015', '015_payments_live_role.sql'],
  ['016', '016_live_entitlement_readers.sql'],
  ['021', '021_guest_payments.sql'],
  ['022', '022_guest_receipt_queue.sql'],
  ['023', '023_guest_receipt_sender.sql'],
  ['025', '025_auto_renewal.sql'],
];
const ALWAYS = new Set(['025']);

class SetupError extends Error {
  constructor(step, code) { super(step); this.step = step; if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) this.code = code; }
}

export function loadMigrations(read = file => readFileSync(new URL(`../../db/resolute/${file}`, import.meta.url), 'utf8')) {
  return MIGRATIONS.map(([id, file]) => {
    const sql = read(file);
    // Each file wraps itself in BEGIN/COMMIT; the job owns the transaction instead (to set its timeouts first).
    if (sql.match(/^BEGIN;$/gm)?.length !== 1 || sql.match(/^COMMIT;$/gm)?.length !== 1) throw new SetupError(`migration-${id}-shape`);
    return {id, body: sql.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')};
  });
}

/** A quoted SQL literal for ALTER ROLE … PASSWORD, which cannot take bind parameters. Only 64 lowercase hex characters
 * are accepted, so the literal can never contain a quote or backslash; quotes are doubled all the same. */
export function passwordLiteral(password) {
  if (typeof password !== 'string' || !HEX64.test(password)) throw new SetupError('password-format');
  return `'${password.replace(/'/g, "''")}'`;
}

const one = async (client, sql, params = []) => (await client.query(sql, params)).rows[0];

/** Read-only catalog check. Booleans only. */
export async function checkLiveDb(client) {
  const admin = await one(client, 'SELECT (rolsuper OR rolcreaterole) AS ok FROM pg_roles WHERE rolname = current_user');
  const ledger = await one(client, 'SELECT to_regclass($1) IS NOT NULL AS orders, to_regclass($2) IS NOT NULL AS periods',
    [`${S}.orders`, `${S}.entitlement_periods`]);
  const roleRows = (await client.query('SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = ANY($1::text[])',
    [[WRITER, SENDER, ...CONSUMERS]])).rows;
  const role = name => roleRows.find(r => r.rolname === name);
  let readers = false;
  if (ledger.periods && CONSUMERS.every(role)) {
    readers = true;
    for (const name of CONSUMERS) {
      const r = await one(client, `SELECT has_schema_privilege($1, $2, 'USAGE') AND has_table_privilege($1, $3, 'SELECT') AS ok`,
        [name, S, `${S}.entitlement_periods`]);
      readers &&= r.ok === true;
    }
  }
  const guestColumn = ledger.orders ? (await one(client,
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'orders' AND column_name = 'guest_id') AS ok`, [S])).ok === true : false;
  const receipts = await one(client, 'SELECT to_regclass($1) IS NOT NULL AS ok', [`${S}.guest_receipts`]);
  const plans = await one(client, 'SELECT to_regclass($1) IS NOT NULL AS ok', [`${S}.renewal_plans`]);
  const writerInsert = plans.ok && role(WRITER) ? (await one(client, `SELECT has_table_privilege($1, $2, 'INSERT') AS ok`,
    [WRITER, `${S}.renewal_plans`])).ok === true : false;
  return {
    adminConnection: admin?.ok === true,
    liveLedger: ledger.orders === true && ledger.periods === true,
    migrations: {
      '015': Boolean(role(WRITER)),
      '016': readers,
      '021': guestColumn,
      '022': receipts.ok === true,
      '023': Boolean(role(SENDER)),
      '025': plans.ok === true && writerInsert,
    },
    roles: {
      [WRITER]: {exists: Boolean(role(WRITER)), login: role(WRITER)?.rolcanlogin === true},
      [SENDER]: {exists: Boolean(role(SENDER)), login: role(SENDER)?.rolcanlogin === true},
    },
  };
}

async function inTransaction(client, step, work) {
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query('SELECT pg_advisory_xact_lock(7180499)');
    await work();
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* the connection already ended the transaction */ }
    throw error instanceof SetupError ? error : new SetupError(step, error?.code);
  }
}

/** Applies what is missing, sets the logins, and returns the before/after check. */
export async function applyLiveDb(client, env, migrations = loadMigrations()) {
  // Validate every input before the first change.
  const writerPassword = passwordLiteral(env.RESOLUTE_PAYMENT_LIVE_DB_PASSWORD);
  const before = await checkLiveDb(client);
  if (!before.adminConnection) throw new SetupError('admin-required');
  if (!before.liveLedger) throw new SetupError('live-ledger-missing');
  const senderNeedsLogin = !before.roles[SENDER].login;
  const senderPassword = senderNeedsLogin ? passwordLiteral(env.RESOLUTE_GUEST_RECEIPT_DB_PASSWORD) : null;
  if (senderPassword && env.RESOLUTE_GUEST_RECEIPT_DB_PASSWORD === env.RESOLUTE_PAYMENT_LIVE_DB_PASSWORD) throw new SetupError('password-reuse');
  const applied = [];
  for (const {id, body} of migrations) {
    if (before.migrations[id] && !ALWAYS.has(id)) continue;
    await inTransaction(client, `migration-${id}`, () => client.query(body));
    applied.push(id);
  }
  await inTransaction(client, 'writer-login', () => client.query(`ALTER ROLE ${WRITER} LOGIN PASSWORD ${writerPassword}`));
  let senderLoginEnabled = false;
  if (senderPassword) {
    await inTransaction(client, 'sender-login', async () => {
      const r = await one(client, 'SELECT rolcanlogin FROM pg_roles WHERE rolname = $1', [SENDER]);
      if (!r) throw new SetupError('sender-role-missing');
      if (r.rolcanlogin) return; // someone enabled it meanwhile: leave its password alone
      await client.query(`ALTER ROLE ${SENDER} LOGIN PASSWORD ${senderPassword}`);
      senderLoginEnabled = true;
    });
  }
  const after = await checkLiveDb(client);
  return {before, applied, writerPasswordSet: true, senderLoginEnabled, after};
}

export function setupUrl(env) {
  let url;
  try { url = new URL(env.RESOLUTE_SETUP_DB_URL ?? ''); } catch { throw new SetupError('invalid-scope'); }
  const user = decodeURIComponent(url.username);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== 'postgres.railway.internal' ||
      decodeURIComponent(url.pathname) !== '/resolute' || !user || user.startsWith('resolute_') || !url.password || url.search || url.hash) throw new SetupError('invalid-scope');
  return url.toString();
}

export async function main(env = process.env, connect = connectionString => new pg.Client({connectionString, ssl: false,
  connectionTimeoutMillis: 10000, statement_timeout: 40000, query_timeout: 45000, application_name: 'resolute-live-db-setup'})) {
  const mode = env.RESOLUTE_LIVE_DB_SETUP;
  if (mode !== 'check' && mode !== 'apply') return {event: 'RESOLUTE_LIVE_DB_SETUP_DISABLED'};
  const config = liveConfigSelfCheck(env);
  const migrations = mode === 'apply' ? loadMigrations() : null;
  if (mode === 'apply') passwordLiteral(env.RESOLUTE_PAYMENT_LIVE_DB_PASSWORD); // fail before connecting
  const client = connect(setupUrl(env));
  try {
    await client.connect();
    if (mode === 'check') {
      await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
      return {event: 'RESOLUTE_LIVE_DB_SETUP_CHECK', mode, database: 'resolute', config, ...(await checkLiveDb(client))};
    }
    const result = await applyLiveDb(client, env, migrations);
    return {event: 'RESOLUTE_LIVE_DB_SETUP_APPLIED', mode, database: 'resolute', config, ...result};
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(r => console.log(JSON.stringify(r))).catch(error => {
    console.error(JSON.stringify({event: 'RESOLUTE_LIVE_DB_SETUP_FAILED', step: error instanceof SetupError ? error.message : 'unexpected',
      ...(error instanceof SetupError && error.code ? {code: error.code} : {})}));
    process.exitCode = 1;
  });
}
