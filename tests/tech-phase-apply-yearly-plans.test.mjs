import test from 'node:test';
import assert from 'node:assert/strict';
import {applyYearlyPlans, main} from '../scripts/tech-phase/apply-yearly-plans.mjs';

test('yearly migration job does nothing unless a mode is set', async () => {
  assert.deepEqual(await main({}), {event: 'TECH_PHASE_YEARLY_APPLY_DISABLED'});
  assert.deepEqual(await main({TECH_PHASE_APPLY_YEARLY: 'yes'}), {event: 'TECH_PHASE_YEARLY_APPLY_DISABLED'});
});
test('yearly migration job refuses a wrong host, wrong database or mode mismatch', async () => {
  const base = {TECH_PHASE_APPLY_YEARLY: 'live', TECH_PHASE_APPLY_DB_URL: 'postgresql://u:p@postgres.railway.internal:5432/tech_phase_billing_live'};
  for (const patch of [
    {TECH_PHASE_APPLY_DB_URL: 'postgresql://u:p@example.com:5432/tech_phase_billing_live'},
    {TECH_PHASE_APPLY_DB_URL: 'postgresql://u:p@postgres.railway.internal:5432/tech_phase_billing_sandbox'},
    {TECH_PHASE_APPLY_DB_URL: 'postgresql://u:p@postgres.railway.internal:5432/resolute'},
  ]) await assert.rejects(main({...base, ...patch}), /Invalid apply scope/);
});

const SCHEMA = `CREATE SCHEMA tech_phase_billing_live;
 CREATE TABLE tech_phase_billing_live.subscriptions(id int, currency text, minor int,
   CONSTRAINT subscriptions_offer_check CHECK ((currency = 'JPY' AND minor = 2980) OR (currency = 'USD' AND minor = 2000)));
 CREATE TABLE tech_phase_billing_live.periods(period_start timestamptz, period_end timestamptz,
   CONSTRAINT periods_interval CHECK (period_end - period_start >= interval '27 days' AND period_end - period_start < interval '32 days'));
 INSERT INTO tech_phase_billing_live.subscriptions VALUES (1, 'JPY', 2980);
 INSERT INTO tech_phase_billing_live.periods VALUES ('2026-01-01', '2026-02-01');`;
async function db() {
  const {PGlite} = await import('@electric-sql/pglite');
  const d = new PGlite();
  const client = {
    query: async (sql, params) => params ? d.query(sql, params) : (r => ({rows: Array.isArray(r) ? (r.at(-1)?.rows ?? []) : (r.rows ?? [])}))(await d.exec(sql)),
  };
  return {d, client};
}
test('yearly migration widens prices and window, keeps existing rows, and a second run is a no-op', async () => {
  const {d, client} = await db();
  try {
    await d.exec(SCHEMA);
    await assert.rejects(d.exec("INSERT INTO tech_phase_billing_live.subscriptions VALUES (2, 'JPY', 29800)"));
    const checks = await applyYearlyPlans(client, 'live');
    assert.deepEqual(checks, {offerAllowsYearly: true, windowAllowsYearly: true});
    await d.exec("INSERT INTO tech_phase_billing_live.subscriptions VALUES (2, 'JPY', 29800), (3, 'USD', 20000)");
    await d.exec("INSERT INTO tech_phase_billing_live.periods VALUES ('2026-01-01', '2027-01-01')");
    await assert.rejects(d.exec("INSERT INTO tech_phase_billing_live.subscriptions VALUES (4, 'JPY', 12345)"));
    await assert.rejects(d.exec("INSERT INTO tech_phase_billing_live.periods VALUES ('2026-01-01', '2026-06-01')"));
    assert.equal((await d.query('SELECT count(*)::int AS n FROM tech_phase_billing_live.subscriptions')).rows[0].n, 3);
    assert.deepEqual(await applyYearlyPlans(client, 'live'), {offerAllowsYearly: true, windowAllowsYearly: true});
  } finally { await d.close(); }
});
test('yearly migration stops when a required table is missing', async () => {
  const {d, client} = await db();
  try {
    await d.exec('CREATE SCHEMA tech_phase_billing_live;');
    await assert.rejects(applyYearlyPlans(client, 'live'), /Required table missing/);
    await assert.rejects(applyYearlyPlans(client, 'other'), /Invalid apply scope/);
  } finally { await d.close(); }
});
