import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';

const sql = execFileSync('python3', ['-c',
  "import runpy; print(runpy.run_path('scripts/resolute/backup.py')['PAYMENT_RESTORE_CHECK'])"], {encoding:'utf8'});

test('restored payment check detects mismatched ownership, missing grants/audit and revived refunds', async () => {
  const bootstrap = new PGlite();
  await bootstrap.exec('CREATE DATABASE resolute');
  const data = await bootstrap.dumpDataDir(); await bootstrap.close();
  const db = new PGlite({database:'resolute', loadDataDir:data});
  try {
    // An old backup without the payment schema cannot pass payment acceptance.
    await assert.rejects(db.query(sql));
    await db.exec(readFileSync(new URL('../db/resolute/010_payments_sandbox.sql', import.meta.url), 'utf8'));
    const check = async () => JSON.parse((await db.query(sql)).rows[0].json_build_object);
    assert.equal((await check()).orders, 0);
    await db.exec(`INSERT INTO resolute_payments_sandbox.orders
      (id,user_id,request_key,capture_key,quote,paypal_id,capture_id,state,created_at,expires_at,paid_at)
      VALUES ('00000000-0000-4000-8000-000000000001','user_test',
      '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',
      '{"product":"resolute_v1","kind":"initial"}','ORDER','CAPTURE','paid',
      '2026-10-16Z','2026-10-17Z','2026-10-16Z')`);
    assert.equal((await check()).missing_grants, 1);
    await db.exec(`INSERT INTO resolute_payments_sandbox.grants
      VALUES ('00000000-0000-4000-8000-000000000001','user_test','initial','2026-10-16Z','2027-10-16Z','active')`);
    assert.equal((await check()).invalid_grants, 1);
    await db.exec(`INSERT INTO resolute_payments_sandbox.audit(order_id,code)
      VALUES ('00000000-0000-4000-8000-000000000001','SANDBOX_ACCESS_GRANTED')`);
    assert.equal((await check()).invalid_grants, 0);
    await db.exec("UPDATE resolute_payments_sandbox.grants SET user_id='user_other'");
    assert.equal((await check()).invalid_grants, 1);
    await db.exec("UPDATE resolute_payments_sandbox.grants SET user_id='user_test'; UPDATE resolute_payments_sandbox.orders SET state='revoked'");
    assert.equal((await check()).invalid_grants, 1);
    await db.exec("UPDATE resolute_payments_sandbox.grants SET state='revoked'");
    assert.equal((await check()).invalid_grants, 0);
    await db.exec("UPDATE resolute_payments_sandbox.orders SET quote='{}'");
    assert.equal((await check()).invalid_grants, 1);
  } finally { await db.close(); }
});
