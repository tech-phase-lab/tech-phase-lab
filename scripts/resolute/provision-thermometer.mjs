/** Explicit one-time operator job. Never exposed through HTTP, API startup or the refresh worker.
 * Creates the thermometer snapshot table and two dedicated login roles in the `resolute` database:
 *   resolute_thermometer_writer  SELECT + INSERT only (used by the refresh worker)
 *   resolute_thermometer_reader  SELECT only, read-only transactions (used by the page)
 * The role passwords are supplied through the environment; this script never prints or generates them.
 */
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const schema = readFileSync(new URL('./thermometer-schema.sql', import.meta.url), 'utf8');
const HEX64 = /^[a-f0-9]{64}$/;
const TABLE = 'resolute.resolute_thermometer_snapshots';

export async function provisionThermometer(client, writerPassword, readerPassword) {
  const existing = await client.query('SELECT to_regclass($1) AS table_name', [TABLE]);
  if (existing.rows[0].table_name) throw Error('Already provisioned: inspect before running again');
  const roles = await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('resolute_thermometer_writer','resolute_thermometer_reader')");
  if (roles.rowCount) throw Error('Role already exists: inspect before running again');
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(7180431)');
    await client.query('SET LOCAL search_path = resolute');
    await client.query(schema);
    await client.query('SET LOCAL search_path = DEFAULT');
    for (const [role, password] of [['resolute_thermometer_writer', writerPassword], ['resolute_thermometer_reader', readerPassword]]) {
      await client.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
      await client.query(`GRANT CONNECT ON DATABASE resolute TO ${role}`);
      await client.query(`GRANT USAGE ON SCHEMA resolute TO ${role}`);
      await client.query(`ALTER ROLE ${role} IN DATABASE resolute SET search_path = resolute`);
      await client.query(`ALTER ROLE ${role} IN DATABASE resolute SET statement_timeout = 5000`);
    }
    await client.query(`GRANT SELECT, INSERT ON ${TABLE} TO resolute_thermometer_writer`);
    await client.query(`GRANT SELECT ON ${TABLE} TO resolute_thermometer_reader`);
    await client.query('ALTER ROLE resolute_thermometer_reader IN DATABASE resolute SET default_transaction_read_only = on');
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  // Checks run inside one transaction that is always rolled back: nothing is left behind.
  await client.query('BEGIN');
  try {
    const probe = "INSERT INTO resolute.resolute_thermometer_snapshots (session_date, snapshot) VALUES ('2000-01-03', '{\"asOf\":\"2000-01-03\"}'::jsonb)";
    await client.query('SET LOCAL ROLE resolute_thermometer_writer');
    await client.query(probe);
    await client.query(`SELECT snapshot FROM ${TABLE} WHERE session_date = '2000-01-03'`);
    for (const [name, sql] of [
      ['update', `UPDATE ${TABLE} SET snapshot = snapshot`],
      ['delete', `DELETE FROM ${TABLE}`],
      ['truncate', `TRUNCATE ${TABLE}`],
      ['ddl', 'CREATE TABLE resolute.thermometer_probe (a int)'],
    ]) {
      await client.query('SAVEPOINT denied');
      let denied = false;
      try { await client.query(sql); } catch { denied = true; }
      await client.query('ROLLBACK TO SAVEPOINT denied');
      if (!denied) throw Error(`Writer unexpectedly permits ${name}`);
    }
    await client.query('RESET ROLE');
    await client.query('SET LOCAL ROLE resolute_thermometer_reader');
    await client.query(`SELECT snapshot FROM ${TABLE}`);
    await client.query('SAVEPOINT denied');
    let denied = false;
    try { await client.query(probe); } catch { denied = true; }
    await client.query('ROLLBACK TO SAVEPOINT denied');
    if (!denied) throw Error('Reader unexpectedly permits writes');
  } finally { await client.query('ROLLBACK'); }
}

async function verifyLogin(url, role, password, expectReadOnly) {
  const login = new URL(url); login.username = role; login.password = password;
  const client = new pg.Client({connectionString: login.toString(), ssl: false, connectionTimeoutMillis: 10000});
  try {
    await client.connect();
    const r = await client.query(`SELECT current_user, current_database(), current_setting('default_transaction_read_only') AS read_only, current_setting('search_path') AS search_path, (SELECT count(*)::int FROM ${TABLE.replace('resolute.', '')}) AS count`);
    const row = r.rows[0];
    if (row.current_user !== role || row.current_database !== 'resolute' || row.count !== 0 || row.search_path !== 'resolute' || (row.read_only === 'on') !== expectReadOnly) throw Error('Login verification failed');
  } finally { await client.end(); }
}

export async function main(env = process.env) {
  if (env.RESOLUTE_PROVISION_THERMOMETER !== 'true') return {event: 'RESOLUTE_THERMOMETER_PROVISION_DISABLED'};
  const url = new URL(env.RESOLUTE_SETUP_DB_URL);
  const writerPassword = env.RESOLUTE_THERMOMETER_WRITER_PASSWORD ?? '', readerPassword = env.RESOLUTE_THERMOMETER_READER_PASSWORD ?? '';
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== 'postgres.railway.internal' || url.pathname !== '/resolute'
    || !HEX64.test(writerPassword) || !HEX64.test(readerPassword) || writerPassword === readerPassword) throw Error('Invalid setup scope');
  const client = new pg.Client({connectionString: url.toString(), ssl: false, connectionTimeoutMillis: 10000, statement_timeout: 10000, query_timeout: 15000});
  try {
    await client.connect();
    await provisionThermometer(client, writerPassword, readerPassword);
  } finally { await client.end(); }
  await verifyLogin(url.toString(), 'resolute_thermometer_writer', writerPassword, false);
  await verifyLogin(url.toString(), 'resolute_thermometer_reader', readerPassword, true);
  return {event: 'RESOLUTE_THERMOMETER_PROVISION_OK', database: 'resolute', table: TABLE,
    roles: ['resolute_thermometer_writer', 'resolute_thermometer_reader'],
    checks: ['writer-select-insert', 'writer-update-delete-truncate-ddl-denied', 'reader-select', 'reader-write-denied', 'both-logins', 'probes-rolled-back']};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(r => console.log(JSON.stringify(r))).catch(() => { console.error('RESOLUTE_THERMOMETER_PROVISION_FAILED'); process.exitCode = 1; });
}
