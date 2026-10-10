import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveResoluteEntitlements} from '../lib/resolute/entitlements.ts';
import {resoluteDatabaseConfig} from '../lib/resolute/database-config.ts';

const start = '2027-01-01T00:00:00Z';
const end = '2028-01-01T00:00:00Z';
const use = {kind:'use',startsAt:start,expiresAt:null,revokedAt:null};
const alerts = {kind:'alerts',startsAt:start,expiresAt:end,revokedAt:null};
test('RESOLUTE needs a purchase even when PRO or owner metadata claims access', () => {
  for(const metadata of [{plan:'free'},{plan:'pro'},{isAdmin:true,ownerMode:true},{membershipPreview:{plan:'pro'}}]) {
    const empty=resolveResoluteEntitlements([],start,metadata);
    assert.equal(empty.canUseTools,false);
    assert.equal(empty.canReceiveNotifications,false);
  }
  assert.equal(resolveResoluteEntitlements([use],end).canUseTools,true);
  assert.equal(resolveResoluteEntitlements([alerts],start).canReceiveNotifications,false);
});
test('notification period includes start, excludes exact expiry and survives PRO cancellation', () => {
  const before = resolveResoluteEntitlements([use,alerts],'2026-12-31T23:59:59.999Z');
  assert.equal(before.alerts.status,'scheduled');
  assert.equal(before.canReceiveNotifications,false);
  assert.equal(resolveResoluteEntitlements([use,alerts],start).canReceiveNotifications,true);
  assert.equal(resolveResoluteEntitlements([use,alerts],'2027-12-31T23:59:59.999Z').canReceiveNotifications,true);
  const expired=resolveResoluteEntitlements([use,alerts],end);
  assert.equal(expired.alerts.status,'expired');
  assert.equal(expired.canUseTools,true);
  assert.equal(expired.canReceiveNotifications,false);
});
test('revocation of either entitlement closes notifications without deleting the other record', () => {
  for(const records of [[{...use,revokedAt:start},alerts],[use,{...alerts,revokedAt:start}]]) {
    assert.equal(resolveResoluteEntitlements(records,start).canReceiveNotifications,false);
  }
  assert.equal(resolveResoluteEntitlements([use,{...alerts,revokedAt:start}],start).canUseTools,true);
});
test('corrupted, duplicate and invalid-period records fail instead of granting or reporting missing access', () => {
  for(const records of [[use,use],[{...alerts,expiresAt:null}],[{...alerts,expiresAt:start}],
    [{...use,expiresAt:end}],[{...use,startsAt:'2027-02-30T00:00:00Z'}],
    [{...alerts,revokedAt:'invalid'}],[{...use,kind:'pro'}]]) {
    assert.throws(()=>resolveResoluteEntitlements(records,start));
  }
  assert.throws(()=>resolveResoluteEntitlements([use],'invalid'));
});
test('dedicated DB configuration rejects unrelated databases and unverified public TLS', () => {
  for(const url of [undefined,'','invalid','https://u:p@example.test/resolute',
    'postgres://u:p@example.test/news','postgres://u:p@example.test/resolute?sslmode=require',
    'postgres://u:p@example.test/resolute?sslmode=disable',
    'postgres://u:p@example.test/resolute?sslrootcert=untrusted']) {
    assert.throws(()=>resoluteDatabaseConfig(url));
  }
  assert.deepEqual(resoluteDatabaseConfig('postgres://u:p@example.test/resolute').ssl,{rejectUnauthorized:true});
  assert.equal(resoluteDatabaseConfig('postgres://u:p@postgres.railway.internal/resolute').ssl,false);
});
