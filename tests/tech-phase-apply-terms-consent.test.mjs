import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTermsConsent, main} from '../scripts/tech-phase/apply-terms-consent.mjs';

test('consent-column job does nothing unless a mode is set, and refuses any other database', async () => {
  assert.deepEqual(await main({}), {event: 'TECH_PHASE_TERMS_CONSENT_APPLY_DISABLED'});
  assert.deepEqual(await main({TECH_PHASE_APPLY_TERMS_CONSENT: 'yes'}), {event: 'TECH_PHASE_TERMS_CONSENT_APPLY_DISABLED'});
  const base = {TECH_PHASE_APPLY_TERMS_CONSENT: 'live'};
  for (const url of ['postgresql://u:p@example.com:5432/tech_phase_billing_live', 'postgresql://u:p@postgres.railway.internal:5432/tech_phase_billing_sandbox',
    'postgresql://u:p@postgres.railway.internal:5432/resolute'])
    await assert.rejects(main({...base, TECH_PHASE_APPLY_DB_URL: url}), /Invalid apply scope/);
});

test('consent-column job adds the nullable column once, keeps existing rows, and is safe to repeat', async () => {
  const {PGlite} = await import('@electric-sql/pglite');
  const d = new PGlite();
  const client = {query: async (sql, params) => params ? d.query(sql, params) : (r => ({rows: Array.isArray(r) ? (r.at(-1)?.rows ?? []) : (r.rows ?? [])}))(await d.exec(sql))};
  try {
    await assert.rejects(applyTermsConsent(client, 'live'), /Required table missing/);
    await d.exec(`CREATE SCHEMA tech_phase_billing_live; CREATE TABLE tech_phase_billing_live.subscriptions(id int); INSERT INTO tech_phase_billing_live.subscriptions VALUES (1);`);
    assert.deepEqual(await applyTermsConsent(client, 'live'), {consentColumn: true});
    assert.deepEqual(await applyTermsConsent(client, 'live'), {consentColumn: true});
    assert.deepEqual((await d.query('SELECT id, terms_consent_at FROM tech_phase_billing_live.subscriptions')).rows, [{id: 1, terms_consent_at: null}]);
    await assert.rejects(applyTermsConsent(client, 'prod'), /Invalid apply scope/);
  } finally { await d.close(); }
});
