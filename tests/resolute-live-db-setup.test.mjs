import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {applyLiveDb, checkLiveDb, loadMigrations, main, passwordLiteral, setupUrl, MIGRATIONS} from '../scripts/resolute/live-db-setup.mjs';
import {liveConfigSelfCheck} from '../services/resolute-api/payments/live-config-check.mjs';

const WRITER_PW = 'a'.repeat(64), SENDER_PW = 'b'.repeat(64);
const URL_OK = `postgresql://postgres:${'c'.repeat(32)}@postgres.railway.internal:5432/resolute`;
const adapter = d => ({query: async (sql, params) => params ? d.query(sql, params) : (r => ({rows: Array.isArray(r) ? (r.at(-1)?.rows ?? []) : (r.rows ?? [])}))(await d.exec(sql))});
async function resoluteDb(t) {
  const boot = new PGlite(); await boot.exec('CREATE DATABASE resolute'); const data = await boot.dumpDataDir(); await boot.close();
  const d = new PGlite({database: 'resolute', loadDataDir: data}); t.after(() => d.close());
  return d;
}
const allFalse = {'015': false, '016': false, '021': false, '022': false, '023': false, '025': false};
// Nothing secret may appear anywhere in the output.
const clean = (out, ...secrets) => { const s = JSON.stringify(out); for (const x of secrets) assert.ok(!s.includes(x)); assert.ok(!/postgres(ql)?:\/\//.test(s)); };

test('setup job is inert unless the mode is check or apply, and refuses any other database or a scoped role', async () => {
  let connects = 0;
  const connect = () => { connects++; throw Error('must not connect'); };
  for (const mode of [undefined, '', 'yes', 'APPLY', 'true']) assert.deepEqual(await main({RESOLUTE_LIVE_DB_SETUP: mode}, connect), {event: 'RESOLUTE_LIVE_DB_SETUP_DISABLED'});
  for (const url of [undefined, 'not a url', `postgresql://postgres:p@example.com:5432/resolute`, `postgresql://postgres:p@postgres.railway.internal:5432/railway`,
    `postgresql://resolute_api_reader:p@postgres.railway.internal:5432/resolute`, `postgresql://postgres@postgres.railway.internal:5432/resolute`,
    `postgresql://postgres:p@postgres.railway.internal:5432/resolute?sslmode=disable`, `mysql://postgres:p@postgres.railway.internal:5432/resolute`])
    await assert.rejects(main({RESOLUTE_LIVE_DB_SETUP: 'check', RESOLUTE_SETUP_DB_URL: url}, connect), /invalid-scope/);
  assert.equal(setupUrl({RESOLUTE_SETUP_DB_URL: URL_OK}), URL_OK);
  // apply without a valid writer password stops before connecting.
  for (const pw of [undefined, 'A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(63)}'`]) await assert.rejects(
    main({RESOLUTE_LIVE_DB_SETUP: 'apply', RESOLUTE_SETUP_DB_URL: URL_OK, RESOLUTE_PAYMENT_LIVE_DB_PASSWORD: pw}, connect), /password-format/);
  assert.equal(connects, 0);
  assert.equal(passwordLiteral(WRITER_PW), `'${WRITER_PW}'`);
});

test('Clerk key self-check reports booleans only', () => {
  assert.deepEqual(liveConfigSelfCheck({}), {paymentClerkKeySet: false, paymentClerkKeyLive: false});
  assert.deepEqual(liveConfigSelfCheck({RESOLUTE_PAYMENT_CLERK_SECRET_KEY: 'sk_test_x'}), {paymentClerkKeySet: true, paymentClerkKeyLive: false});
  assert.deepEqual(liveConfigSelfCheck({RESOLUTE_PAYMENT_CLERK_SECRET_KEY: 'sk_live_secretvalue'}), {paymentClerkKeySet: true, paymentClerkKeyLive: true});
  assert.ok(!JSON.stringify(liveConfigSelfCheck({RESOLUTE_PAYMENT_CLERK_SECRET_KEY: 'sk_live_secretvalue'})).includes('secretvalue'));
  // The API logs the same booleans at startup.
  assert.match(readFileSync(new URL('../services/resolute-api/index.mjs', import.meta.url), 'utf8'), /event:'RESOLUTE_LIVE_CONFIG_CHECK',\.\.\.liveConfigSelfCheck\(process\.env\)/);
});

test('check mode runs read-only and prints names and booleans only', async () => {
  const queries = [], ended = [];
  const fake = {connect: async () => {}, end: async () => ended.push(true), query: async (sql, params) => {
    queries.push(sql);
    if (/rolsuper OR rolcreaterole/.test(sql)) return {rows: [{ok: true}]};
    if (/to_regclass\(\$1\) IS NOT NULL AS orders/.test(sql)) return {rows: [{orders: true, periods: true}]};
    if (/FROM pg_roles WHERE rolname = ANY/.test(sql)) return {rows: [{rolname: 'resolute_payment_live_writer', rolcanlogin: true}]};
    if (/information_schema\.columns/.test(sql)) return {rows: [{ok: true}]};
    if (/to_regclass\(\$1\) IS NOT NULL AS ok/.test(sql)) return {rows: [{ok: params[0].endsWith('guest_receipts')}]};
    if (/has_table_privilege/.test(sql)) return {rows: [{ok: true}]};
    return {rows: []};
  }};
  const out = await main({RESOLUTE_LIVE_DB_SETUP: 'check', RESOLUTE_SETUP_DB_URL: URL_OK, RESOLUTE_PAYMENT_CLERK_SECRET_KEY: 'sk_live_hidden'}, () => fake);
  assert.equal(queries[0], 'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  for (const sql of queries) assert.match(sql, /^(SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY|SELECT )/);
  assert.deepEqual(ended, [true]);
  assert.deepEqual(out, {event: 'RESOLUTE_LIVE_DB_SETUP_CHECK', mode: 'check', database: 'resolute', config: {paymentClerkKeySet: true, paymentClerkKeyLive: true},
    adminConnection: true, liveLedger: true,
    migrations: {'015': true, '016': false, '021': true, '022': true, '023': false, '025': false},
    roles: {resolute_payment_live_writer: {exists: true, login: true}, resolute_guest_mail_sender: {exists: false, login: false}}});
  clean(out, 'hidden', 'c'.repeat(32));
});

test('every migration file is loaded in order with its own BEGIN/COMMIT removed', () => {
  assert.deepEqual(MIGRATIONS.map(m => m[0]), ['015', '016', '021', '022', '023', '025']);
  const loaded = loadMigrations();
  for (const m of loaded) { assert.doesNotMatch(m.body, /^BEGIN;$/m); assert.doesNotMatch(m.body, /^COMMIT;$/m); }
  assert.throws(() => loadMigrations(() => 'CREATE TABLE x();'), /migration-015-shape/);
  // The image ships exactly these files.
  const docker = readFileSync(new URL('../services/resolute-live-db-setup/Dockerfile', import.meta.url), 'utf8');
  for (const [, file] of MIGRATIONS) assert.ok(docker.includes(`db/resolute/${file}`), file);
  assert.match(docker, /^RUN node scripts\/resolute\/live-db-setup\.mjs$/m);
  assert.match(docker, /^CMD \["timeout", .*"node", "scripts\/resolute\/live-db-setup\.mjs"\]$/m);
});

test('apply brings a bare live ledger to the full state once, is safe to repeat, and leaves an enabled sender alone', async t => {
  const d = await resoluteDb(t), client = adapter(d);
  await d.exec(await readFile(new URL('../db/resolute/014_payments_live.sql', import.meta.url), 'utf8'));
  await d.exec('CREATE ROLE resolute_api_reader NOLOGIN');
  const before = await checkLiveDb(client);
  assert.deepEqual(before.migrations, allFalse); assert.equal(before.liveLedger, true); assert.equal(before.adminConnection, true);

  const env = {RESOLUTE_PAYMENT_LIVE_DB_PASSWORD: WRITER_PW};
  // The sender will be created NOLOGIN, so its password is required up front, before any change.
  await assert.rejects(applyLiveDb(client, env), /password-format/);
  assert.deepEqual((await checkLiveDb(client)).migrations, allFalse);
  await assert.rejects(applyLiveDb(client, {...env, RESOLUTE_GUEST_RECEIPT_DB_PASSWORD: WRITER_PW}), /password-reuse/);

  const first = await applyLiveDb(client, {...env, RESOLUTE_GUEST_RECEIPT_DB_PASSWORD: SENDER_PW});
  assert.deepEqual(first.applied, ['015', '016', '021', '022', '023', '025']);
  assert.equal(first.senderLoginEnabled, true); assert.equal(first.writerPasswordSet, true);
  assert.deepEqual(first.after.migrations, {'015': true, '016': true, '021': true, '022': true, '023': true, '025': true});
  assert.deepEqual(first.after.roles, {resolute_payment_live_writer: {exists: true, login: true}, resolute_guest_mail_sender: {exists: true, login: true}});
  clean(first, WRITER_PW, SENDER_PW);

  // Second run: only 025 (re-runnable) runs; the sender already logs in, so no sender password is needed or used.
  const second = await applyLiveDb(client, env);
  assert.deepEqual(second.applied, ['025']); assert.equal(second.senderLoginEnabled, false);
  assert.deepEqual(second.after, first.after);
});

test('apply fills only the gaps, and a failing migration rolls back and names its step', async t => {
  const d = await resoluteDb(t), client = adapter(d);
  await d.exec(await readFile(new URL('../db/resolute/014_payments_live.sql', import.meta.url), 'utf8'));
  for (const f of ['015_payments_live_role.sql', '021_guest_payments.sql']) await d.exec(await readFile(new URL(`../db/resolute/${f}`, import.meta.url), 'utf8'));
  // 016 needs the API reader role: without it the step fails, nothing of it remains, and later steps do not run.
  const env = {RESOLUTE_PAYMENT_LIVE_DB_PASSWORD: WRITER_PW, RESOLUTE_GUEST_RECEIPT_DB_PASSWORD: SENDER_PW};
  await assert.rejects(applyLiveDb(client, env), error => error.message === 'migration-016' && error.code === 'P0001');
  const mid = await checkLiveDb(client);
  assert.deepEqual(mid.migrations, {...allFalse, '015': true, '021': true});
  assert.equal(mid.roles.resolute_payment_live_writer.login, false);
  await d.exec('CREATE ROLE resolute_api_reader NOLOGIN');
  const r = await applyLiveDb(client, env);
  assert.deepEqual(r.applied, ['016', '022', '023', '025']);
  assert.ok(Object.values(r.after.migrations).every(Boolean));
});

test('apply refuses without the live ledger', async t => {
  const d = await resoluteDb(t);
  await assert.rejects(applyLiveDb(adapter(d), {RESOLUTE_PAYMENT_LIVE_DB_PASSWORD: WRITER_PW, RESOLUTE_GUEST_RECEIPT_DB_PASSWORD: SENDER_PW}), /live-ledger-missing/);
});
