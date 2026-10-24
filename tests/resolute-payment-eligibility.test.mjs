import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { paymentStore } from '../services/resolute-api/payments/store.mjs';
import { quote } from '../services/resolute-api/payments/policy.mjs';

test('renewal eligibility rejects stale or mismatched grants and ignores their expiry', async () => {
  const bootstrap = new PGlite();
  await bootstrap.exec('CREATE DATABASE resolute');
  const data = await bootstrap.dumpDataDir(); await bootstrap.close();
  const db = new PGlite({ database: 'resolute', loadDataDir: data });
  const store = paymentStore(db);
  const now = Date.parse('2026-10-19T00:00:00Z');
  try {
    await db.exec(readFileSync(new URL('../db/resolute/010_payments_sandbox.sql', import.meta.url), 'utf8'));
    await db.exec(`INSERT INTO resolute_payments_sandbox.orders
      (id,user_id,request_key,capture_key,quote,paypal_id,capture_id,state,created_at,expires_at,paid_at)
      VALUES ('00000000-0000-4000-8000-000000000001','user_test',
      '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',
      '{"product":"resolute_v1","kind":"initial"}','ORDER','CAPTURE','paid',
      '2026-10-16Z','2026-10-17Z','2026-10-16Z');
      INSERT INTO resolute_payments_sandbox.grants VALUES
      ('00000000-0000-4000-8000-000000000001','user_test','initial','2026-10-16Z','2027-10-16Z','active')`);
    const rights = () => store.rights(db, 'user_test', now);
    assert.equal((await rights()).use, true);
    assert.equal(quote('renewal','ja',{pro:false},await rights(),now).minor,5980);
    const corruptions = [
      "state='revoked'", "state='suspended'", "state='held'",
      "user_id='user_other'", "capture_id=NULL", "paid_at=NULL",
      `quote='{"product":"other","kind":"initial"}'`,
      `quote='{"product":"resolute_v1","kind":"renewal"}'`,
    ];
    for (const change of corruptions) {
      await db.exec('BEGIN');
      try {
        await db.exec(`UPDATE resolute_payments_sandbox.orders SET ${change}`);
        const result = await rights();
        assert.deepEqual(result,{use:false,until:0},change);
        assert.throws(()=>quote('renewal','ja',{pro:false},result,now),{code:'INITIAL_PURCHASE_REQUIRED'});
      } finally { await db.exec('ROLLBACK'); }
    }
    for (const state of ['revoked','suspended']) {
      await db.query('UPDATE resolute_payments_sandbox.grants SET state=$1',[state]);
      assert.deepEqual(await rights(),{use:false,until:0});
    }
    await db.exec("UPDATE resolute_payments_sandbox.grants SET state='active'");
    assert.equal((await rights()).until,Date.parse('2027-10-16Z'));
    assert.equal((await store.rights(db,'user_other',now)).use,false);
  } finally { await db.close(); }
});
