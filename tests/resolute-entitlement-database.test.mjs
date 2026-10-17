import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {PGlite} from '@electric-sql/pglite';

// PGlite runs a real PostgreSQL engine in memory. The Pool transport is replaced
// so tests cannot connect to Railway or use production credentials.
const source=readFileSync(new URL('../lib/resolute/database.ts',import.meta.url),'utf8')
  .replace('import "server-only";','')
  .replace('import { Pool } from "pg";', 'class Pool { on() {} query(...args) { return globalThis.__resoluteQuery(...args); } }')
  .replace('from "./database-config.ts"', `from ${JSON.stringify(new URL('../lib/resolute/database-config.ts',import.meta.url).href)}`)
  .replace('from "./entitlements.ts"', `from ${JSON.stringify(new URL('../lib/resolute/entitlements.ts',import.meta.url).href)}`);
const {getResoluteEntitlementsForUser}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const migration=readFileSync(new URL('../db/resolute/001_entitlements.sql',import.meta.url),'utf8');

test('migration and scoped reads enforce independent purchases and valid states in PostgreSQL', async () => {
  const bootstrap=new PGlite();
  await bootstrap.exec('CREATE DATABASE resolute');
  const data=await bootstrap.dumpDataDir();
  await bootstrap.close();
  const db=new PGlite({database:'resolute',loadDataDir:data});
  const saved=process.env.ENTITLEMENT_DB_URL;
  process.env.ENTITLEMENT_DB_URL='postgres://test:test@postgres.railway.internal/resolute';
  globalThis.__resoluteQuery=(sql,args)=>db.query(sql,args);
  const insert=`INSERT INTO resolute.entitlements
    (clerk_user_id,product_id,kind,starts_at,expires_at,source)
    VALUES ($1,$2,$3,$4,$5,'purchase')`;
  try {
    await db.exec(migration);
    const absent=await getResoluteEntitlementsForUser('user_missing');
    assert.equal(absent.use.status,'missing');assert.equal(absent.canUseTools,false);
    await db.query(insert,['user_buyer','resolute_v1','use','2020-01-01T00:00:00Z',null]);
    await db.query(insert,['user_buyer','resolute_v1','alerts','2020-01-01T00:00:00Z','2090-01-01T00:00:00Z']);
    let entitled=await getResoluteEntitlementsForUser('user_buyer');
    assert.equal(entitled.canUseTools,true);assert.equal(entitled.canReceiveNotifications,true);
    assert.equal((await getResoluteEntitlementsForUser('user_other')).canUseTools,false);
    assert.equal((await getResoluteEntitlementsForUser('user_buyerOR1')).canUseTools,false);
    await assert.rejects(()=>getResoluteEntitlementsForUser("user_buyer' OR 1=1--"));
    // DB constraints reject duplicate purchase-state rows, wrong products,
    // malformed IDs, permanent alerts and finite buy-once rights.
    for(const row of [
      ['user_buyer','resolute_v1','use','2020-01-01',null],
      ['user_new','other_product','use','2020-01-01',null],
      ['bad_id','resolute_v1','use','2020-01-01',null],
      ['user_new','resolute_v1','alerts','2020-01-01',null],
      ['user_new','resolute_v1','alerts','2020-01-01','2020-01-01'],
      ['user_new','resolute_v1','use','2020-01-01','2090-01-01'],
      ['user_new','resolute_v1','use','infinity',null],
    ]) await assert.rejects(()=>db.query(insert,row));
    await db.query(`UPDATE resolute.entitlements SET revoked_at=CURRENT_TIMESTAMP WHERE kind='use'`);
    entitled=await getResoluteEntitlementsForUser('user_buyer');
    assert.equal(entitled.use.status,'revoked');assert.equal(entitled.alerts.status,'active');
    assert.equal(entitled.canReceiveNotifications,false);
    await db.exec('DROP SCHEMA resolute CASCADE');
    await assert.rejects(()=>getResoluteEntitlementsForUser('user_buyer'));
  } finally {
    delete globalThis.__resoluteQuery;
    if(saved===undefined)delete process.env.ENTITLEMENT_DB_URL;else process.env.ENTITLEMENT_DB_URL=saved;
    await db.close();
  }
});
test('migration aborts on an unrelated database and leaves no entitlement schema', async () => {
  const db=new PGlite();
  try {
    await assert.rejects(()=>db.exec(migration));
    await db.exec('ROLLBACK');
    const {rows}=await db.query(`SELECT count(*)::int AS count FROM pg_namespace WHERE nspname='resolute'`);
    assert.equal(rows[0].count,0);
  } finally {await db.close();}
});
