import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';

const queries = JSON.parse(execFileSync('python3', ['-c',
  "import runpy,json; b=runpy.run_path('scripts/resolute/backup.py'); print(json.dumps({k:b[k] for k in ['PAYMENT_RESTORE_CHECK','LIVE_PAYMENT_RESTORE_CHECK']}))"], {encoding:'utf8'}));

for (const environment of ['sandbox', 'live']) {
const ledger = `resolute_payments_${environment}`;
const checkSql = queries[environment === 'live' ? 'LIVE_PAYMENT_RESTORE_CHECK' : 'PAYMENT_RESTORE_CHECK'];
test(`${environment}: restored payment check detects mismatched ownership, missing grants/audit and revived refunds`, async () => {
  const bootstrap = new PGlite();
  await bootstrap.exec('CREATE DATABASE resolute');
  const data = await bootstrap.dumpDataDir(); await bootstrap.close();
  const db = new PGlite({database:'resolute', loadDataDir:data});
  try {
    // An old backup without the payment schema cannot pass payment acceptance.
    await assert.rejects(db.query(checkSql));
    await db.exec(readFileSync(new URL(environment === 'live' ? '../db/resolute/014_payments_live.sql' : '../db/resolute/010_payments_sandbox.sql', import.meta.url), 'utf8'));
    const check = async () => JSON.parse((await db.query(checkSql)).rows[0].json_build_object);
    assert.equal((await check()).orders, 0);
    await db.exec(`INSERT INTO ${ledger}.orders
      (id,user_id,request_key,capture_key,quote,paypal_id,capture_id,state,created_at,expires_at,paid_at)
      VALUES ('00000000-0000-4000-8000-000000000001','user_test',
      '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',
      '{"product":"resolute_v1","kind":"initial"}','ORDER','CAPTURE','paid',
      '2026-10-16Z','2026-10-17Z','2026-10-16Z')`);
    assert.equal((await check()).missing_grants, 1);
    await db.exec(`INSERT INTO ${ledger}.grants
      VALUES ('00000000-0000-4000-8000-000000000001','user_test','initial','2026-10-16Z','2027-10-16Z','active')`);
    assert.equal((await check()).invalid_grants, 1);
    await db.exec(`INSERT INTO ${ledger}.audit(order_id,code)
      VALUES ('00000000-0000-4000-8000-000000000001','${environment === 'live' ? 'LIVE_ACCESS_GRANTED' : 'SANDBOX_ACCESS_GRANTED'}')`);
    assert.equal((await check()).invalid_grants, 0);
    await db.exec(`UPDATE ${ledger}.grants SET user_id='user_other'`);
    assert.equal((await check()).invalid_grants, 1);
    await db.exec(`UPDATE ${ledger}.grants SET user_id='user_test'; UPDATE ${ledger}.orders SET state='revoked'`);
    assert.equal((await check()).invalid_grants, 1);
    await db.exec(`UPDATE ${ledger}.grants SET state='revoked'`);
    assert.equal((await check()).invalid_grants, 0);
    await db.exec(`UPDATE ${ledger}.orders SET quote='{}'`);
    assert.equal((await check()).invalid_grants, 1);
  } finally { await db.close(); }
});

}
