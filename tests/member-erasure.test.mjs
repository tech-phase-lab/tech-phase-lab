import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { handleClerkWebhook, verifySvix, memberKeys, erasureRefused, erasureEnabled } from '../lib/account/member-erasure.ts';
import { OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID } from '../lib/membership/entitlements.ts';
import { runErasureJob, ownerIds, monitorClient } from '../scripts/member-erasure-job.mjs';

const OWNERS = [OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID];
const SECRET = 'whsec_' + Buffer.from('fixture-signing-key-not-a-secret').toString('base64');
const NOW = Date.parse('2026-11-20T00:00:00Z');
const ENV = { CLERK_WEBHOOK_SIGNING_SECRET: SECRET, MEMBER_ERASURE_ENABLED: 'true', RESEARCH_MONITOR_URL: 'https://monitor.fixture.test', RESEARCH_MONITOR_TOKEN: 'fixture-token' };

function signed(event, { secret = SECRET, at = NOW } = {}) {
  const body = JSON.stringify(event), id = 'msg_fixture', timestamp = String(Math.floor(at / 1000));
  const key = Buffer.from(secret.slice(6), 'base64');
  const signature = 'v1,' + createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { body, headers: { id, timestamp, signature } };
}

function monitorFetch(calls, reply = () => Response.json({ ok: true, status: 'erased', pushDevices: 2, receipt: 'r' })) {
  return async (url, init) => { calls.push({ url, init }); return reply(url, init); };
}

test('owner ids in every erasure layer match lib/membership/entitlements.ts', () => {
  assert.deepEqual(ownerIds().sort(), [...OWNERS].sort());
  for (const file of ['db/tech-phase/009_member_erasure.sql', 'db/resolute/026_member_erasure.sql', 'scripts/research/member_data_retention.py'])
    for (const id of OWNERS) assert.ok(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').includes(id), `${file} must refuse ${id}`);
});

test('erasure is off unless the flag is exactly true', () => {
  for (const value of [undefined, '', '1', 'yes', 'TRUE ']) assert.equal(erasureEnabled({ MEMBER_ERASURE_ENABLED: value }), value === 'TRUE ');
  assert.equal(erasureEnabled({}), false);
});

test('Svix signatures: valid, wrong key, stale timestamp, tampered body', () => {
  const event = { type: 'user.deleted', data: { id: 'user_departed1', deleted: true } };
  const { body, headers } = signed(event);
  assert.equal(verifySvix(SECRET, headers, body, NOW), true);
  assert.equal(verifySvix('whsec_' + Buffer.from('other').toString('base64'), headers, body, NOW), false);
  assert.equal(verifySvix(SECRET, headers, body, NOW + 6 * 60 * 1000), false);
  assert.equal(verifySvix(SECRET, headers, body.replace('departed1', 'departed2'), NOW), false);
  assert.equal(verifySvix(undefined, headers, body, NOW), false);
  assert.equal(verifySvix(SECRET, { ...headers, signature: 'v1,AAAA ' + headers.signature }, body, NOW), true);
});

test('owner accounts are never erased: refused before the flag, the monitor is never called', async () => {
  for (const id of OWNERS) {
    assert.equal(erasureRefused(id), 'owner-account');
    for (const env of [ENV, { ...ENV, MEMBER_ERASURE_ENABLED: undefined }]) {
      const calls = [], { body, headers } = signed({ type: 'user.deleted', data: { id, deleted: true } });
      const result = await handleClerkWebhook({ env, body, headers, fetch: monitorFetch(calls), now: NOW });
      assert.equal(result.status, 200);
      assert.equal(result.body.status, 'owner-account-refused');
      assert.equal(calls.length, 0);
    }
  }
  assert.equal(erasureRefused('user_erased' + 'a'.repeat(32)), 'invalid-member');
});

test('user.deleted: disabled -> 503 (Svix retries later), enabled -> monitor erase with derived keys', async () => {
  const id = 'user_departed1', { body, headers } = signed({ type: 'user.deleted', data: { id, deleted: true } });
  const off = [], disabled = await handleClerkWebhook({ env: { ...ENV, MEMBER_ERASURE_ENABLED: 'false' }, body, headers, fetch: monitorFetch(off), now: NOW });
  assert.equal(disabled.status, 503);
  assert.equal(off.length, 0);
  const calls = [], result = await handleClerkWebhook({ env: ENV, body, headers, fetch: monitorFetch(calls), now: NOW });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://monitor.fixture.test/member/erase');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.memberId, id);
  assert.deepEqual(sent.keys, memberKeys('fixture-token', id));
  // Same derivations the existing routes use for this member's records.
  assert.equal(sent.keys.savedResearch, createHmac('sha256', 'fixture-token').update(`saved-research:${id}`).digest('hex'));
  assert.equal(sent.keys.question, createHmac('sha256', 'fixture-token').update(`question:${id}`).digest('hex'));
  assert.equal(JSON.stringify(result.body).includes(id), false);
});

test('unsigned, other events and monitor failures', async () => {
  const id = 'user_departed1', { body, headers } = signed({ type: 'user.deleted', data: { id } });
  assert.equal((await handleClerkWebhook({ env: ENV, body, headers: { ...headers, signature: 'v1,bad' }, fetch: monitorFetch([]), now: NOW })).status, 401);
  const other = signed({ type: 'user.updated', data: { id } });
  assert.equal((await handleClerkWebhook({ env: ENV, ...other, fetch: monitorFetch([]), now: NOW })).body.status, 'ignored');
  for (const reply of [() => new Response('no', { status: 500 }), () => Response.json({ ok: false, error: 'disabled' }, { status: 503 }), () => { throw new Error('timeout'); }]) {
    const result = await handleClerkWebhook({ env: ENV, body, headers, fetch: monitorFetch([], reply), now: NOW });
    assert.equal(result.status, 503);
  }
  const insecure = await handleClerkWebhook({ env: { ...ENV, RESEARCH_MONITOR_URL: 'http://monitor.fixture.test' }, body, headers, fetch: monitorFetch([]), now: NOW });
  assert.equal(insecure.status, 503);
});

function fakeDb(name, calls, fail = {}) {
  return { async query(sql, args = []) {
    calls.push({ name, sql, member: args[0] });
    if (fail[args[0]]) throw new Error(fail[args[0]]);
    return { rows: [{ result: sql.includes('purge') ? { erasedMembersPurged: 0 } : 'erased' }] };
  } };
}

test('erasure job: off by default, owner skipped, blocked contracts retried, steps acknowledged', async () => {
  const calls = [], acks = [];
  const monitor = {
    async pending() { return [{ memberId: OWNERS[1], pending: ['billing', 'resolute'] }, { memberId: 'user_departed1', pending: ['billing', 'resolute'] }, { memberId: 'user_renewing2', pending: ['resolute'] }]; },
    async acknowledge(member, step) { acks.push(`${member}:${step}`); },
  };
  const databases = { billing: fakeDb('billing', calls), resolute: fakeDb('resolute', calls, { user_renewing2: 'ERROR: open-renewal' }) };
  const lines = [];
  const off = await runErasureJob({ env: {}, monitor, databases, log: l => lines.push(l) });
  assert.equal(off.erasure, 'disabled');
  assert.equal(calls.length, 0);
  const summary = await runErasureJob({ env: { MEMBER_ERASURE_ENABLED: 'true', RESEARCH_RETENTION_PURGE_ENABLED: 'true' }, monitor, databases, log: l => lines.push(l) });
  assert.equal(summary.skippedOwner, 1);
  assert.equal(calls.some(c => OWNERS.includes(c.member)), false);
  assert.deepEqual(acks, ['user_departed1:billing', 'user_departed1:resolute']);
  assert.deepEqual(summary.blocked, { 'resolute:open-renewal': 1 });
  assert.equal(summary.purge.billing.erasedMembersPurged, 0);
  assert.equal(JSON.stringify(lines).includes('user_departed1'), false);
});

test('monitor client refuses plain http and credentials in the URL', () => {
  assert.throws(() => monitorClient({ RESEARCH_MONITOR_URL: 'http://x.test', RESEARCH_MONITOR_TOKEN: 't' }), /monitor-unconfigured/);
  assert.throws(() => monitorClient({ RESEARCH_MONITOR_URL: 'https://a:b@x.test', RESEARCH_MONITOR_TOKEN: 't' }), /monitor-unconfigured/);
  assert.throws(() => monitorClient({}), /monitor-unconfigured/);
});

test('the account deletion button stays disabled (this change adds no self-service delete)', () => {
  const route = readFileSync(new URL('../app/api/research/account/deletion/route.ts', import.meta.url), 'utf8');
  assert.ok(route.includes('canDelete:false'));
  assert.equal(/deleteUser|users\.delete/.test(readFileSync(new URL('../lib/account/member-erasure.ts', import.meta.url), 'utf8')), false);
});
