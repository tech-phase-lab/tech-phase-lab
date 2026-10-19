/** Explicit operator job: creates an EMPTY ledger, without roles or activation. */
import pg from 'pg';
import { readFileSync } from 'node:fs';
const migration = readFileSync(new URL('../../db/resolute/014_payments_live.sql', import.meta.url), 'utf8');
let client;
try {
const url = new URL(process.env.RESOLUTE_SETUP_DB_URL);
if (url.hostname !== 'postgres.railway.internal' || url.pathname !== '/resolute') {
  throw Error('Invalid setup scope');
}
client = new pg.Client({connectionString: url.toString(), ssl: false,
  connectionTimeoutMillis: 10000, statement_timeout: 10000, query_timeout: 15000});
  await client.connect();
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(7180414)");
  const existing = await client.query("SELECT 1 FROM pg_namespace WHERE nspname='resolute_payments_live'");
  if (existing.rowCount) throw Error('Already provisioned: inspect before retrying');
  await client.query(migration.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, ''));
  for (const name of ['orders', 'grants', 'events', 'audit', 'alert_outbox', 'entitlement_periods']) {
    const rows = await client.query(`SELECT count(*)::int AS count FROM resolute_payments_live.${name}`);
    if (rows.rows[0].count !== 0) throw Error('New ledger must be empty');
  }
  // Existing API credentials must not gain access implicitly through defaults.
  const privileges = await client.query(`SELECT
    has_schema_privilege('resolute_api_reader','resolute_payments_live','USAGE') AS reader,
    has_schema_privilege('resolute_payment_sandbox_writer','resolute_payments_live','USAGE') AS sandbox`);
  if (privileges.rows[0].reader || privileges.rows[0].sandbox) throw Error('Unexpected existing-role access');
  await client.query('COMMIT');
  console.log(JSON.stringify({event:'RESOLUTE_LIVE_LEDGER_PREPARED', tables:5, views:1,
    orders:0, grants:0, existingRolesBlocked:true, activation:false}));
} catch {
  try { await client?.query('ROLLBACK'); } catch {}
  console.error('RESOLUTE_LIVE_LEDGER_PREPARE_FAILED');
  process.exitCode = 1;
} finally { await client?.end(); }
