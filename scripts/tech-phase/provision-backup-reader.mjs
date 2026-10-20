// Prepared one-shot helper; not deployed. Requires approval for temporary admin
// credential injection into tech-phase-billing-provision. Retire/clear afterward.
import pg from 'pg';

const database = 'tech_phase_billing_sandbox';
const role = database + '_backup';
let client;
try {
  const url = new URL(process.env.TECH_PHASE_PROVISION_DB_URL ?? '');
  const password = process.env.TECH_PHASE_BACKUP_DB_PASSWORD ?? '';
  if (url.hostname !== 'postgres.railway.internal' || !/^[a-f0-9]{64}$/.test(password)) {
    throw new Error('guard');
  }
  url.pathname = '/' + database;
  url.search = '';
  client = new pg.Client({ connectionString: url.href, ssl: false,
    connectionTimeoutMillis: 15000, statement_timeout: 30000 });
  await client.connect();
  const current = await client.query('SELECT current_database() AS name');
  if (current.rows[0].name !== database) throw new Error('database');
  await client.query('BEGIN');
  const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
  if (existing.rowCount) throw new Error('role already exists; inspect before retry');
  // Hex-only password cannot inject SQL; no SQL/exception text is logged.
  await client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
  await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
  await client.query(`GRANT USAGE ON SCHEMA ${database} TO ${role}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${database} TO ${role}`);
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${database}_owner
    IN SCHEMA ${database} GRANT SELECT ON TABLES TO ${role}`);
  const check = await client.query(`SELECT
    has_table_privilege($1, '${database}.payments', 'SELECT') AS readable,
    has_table_privilege($1, '${database}.payments', 'INSERT,UPDATE,DELETE') AS writable,
    has_schema_privilege($1, '${database}', 'CREATE') AS creatable`, [role]);
  if (!check.rows[0].readable || check.rows[0].writable || check.rows[0].creatable) {
    throw new Error('privileges');
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({ event: 'TECH_PHASE_BACKUP_READER_READY', readOnly: true }));
} catch {
  if (client) await client.query('ROLLBACK').catch(() => {});
  console.log(JSON.stringify({ event: 'TECH_PHASE_BACKUP_READER_FAILED' }));
  process.exitCode = 1;
} finally {
  await client?.end();
}
