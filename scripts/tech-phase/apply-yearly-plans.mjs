/** Explicit one-time operator job. Never exposed through HTTP or any worker.
 * Applies db/tech-phase/008_yearly_plans.sql to exactly ONE billing database (live or sandbox).
 * Inert unless TECH_PHASE_APPLY_YEARLY is exactly `live` or `sandbox`. The connection comes from TECH_PHASE_APPLY_DB_URL and must point to
 * postgres.railway.internal and to the database named tech_phase_billing_<mode>. It adds no table and no role; it only widens two CHECK
 * constraints (allowed prices and billing window). The migration runs in one transaction with short lock/statement timeouts.
 * Output is names and booleans only: no URL, credential or row data.
 */
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const MODES = ['live', 'sandbox'];

export async function applyYearlyPlans(client, mode, sql = readFileSync(new URL('../../db/tech-phase/008_yearly_plans.sql', import.meta.url), 'utf8')) {
  if (!MODES.includes(mode)) throw Error('Invalid apply scope');
  const schema = `tech_phase_billing_${mode}`;
  for (const table of ['subscriptions', 'periods']) {
    const found = await client.query('SELECT to_regclass($1) AS name', [`${schema}.${table}`]);
    if (!found.rows[0].name) throw Error('Required table missing');
  }
  await client.query("SET lock_timeout = '5s'");
  await client.query("SET statement_timeout = '20s'");
  try {
    await client.query(sql);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connection already reset the transaction */ }
    throw error;
  }
  const defs = await client.query(
    `SELECT c.conname AS name, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
     WHERE c.conrelid IN (to_regclass($1), to_regclass($2)) AND c.conname IN ('subscriptions_offer_check', 'periods_window')`,
    [`${schema}.subscriptions`, `${schema}.periods`]);
  const byName = Object.fromEntries(defs.rows.map(r => [r.name, r.def]));
  const offer = byName.subscriptions_offer_check ?? '';
  const window = byName.periods_window ?? '';
  const checks = {
    offerAllowsYearly: ['29800', '20000', '2980', '2000'].every(value => offer.includes(value)),
    windowAllowsYearly: window.includes('364 days') && window.includes('27 days'),
  };
  if (!checks.offerAllowsYearly || !checks.windowAllowsYearly) throw Error('Verification failed');
  return checks;
}

export async function main(env = process.env) {
  const mode = env.TECH_PHASE_APPLY_YEARLY;
  if (!MODES.includes(mode)) return {event: 'TECH_PHASE_YEARLY_APPLY_DISABLED'};
  const url = new URL(env.TECH_PHASE_APPLY_DB_URL ?? '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== 'postgres.railway.internal' || decodeURIComponent(url.pathname) !== `/tech_phase_billing_${mode}`) throw Error('Invalid apply scope');
  const client = new pg.Client({connectionString: url.toString(), ssl: false, connectionTimeoutMillis: 10000, statement_timeout: 30000, query_timeout: 40000});
  try {
    await client.connect();
    const checks = await applyYearlyPlans(client, mode);
    return {event: 'TECH_PHASE_YEARLY_APPLY_OK', mode, checks};
  } finally { await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(r => console.log(JSON.stringify(r))).catch(() => { console.error('TECH_PHASE_YEARLY_APPLY_FAILED'); process.exitCode = 1; });
}
