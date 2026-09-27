import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePlan} from '../lib/membership/entitlements.ts';
test('PRO requires an explicit server-managed plan and future expiry',()=>{
 const now=Date.parse('2026-09-27T00:00:00Z');
 for(const metadata of [{},{plan:'pro'},{plan:'pro',proExpiresAt:'invalid'},{plan:'pro',proExpiresAt:'2026-09-26'},{plan:'free',proExpiresAt:'2027-01-01'}]) assert.equal(resolvePlan(metadata,now),'free');
 assert.equal(resolvePlan({plan:'pro',proExpiresAt:'2027-01-01'},now),'pro');
 assert.equal(resolvePlan({plan:'pro',proExpiresAt:'2026-09-27T00:00:00Z'},now),'free');
});
