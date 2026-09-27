import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePlan} from '../lib/membership/entitlements.ts';
test('PRO requires an explicit server-managed plan and future expiry',()=>{
 const now=Date.parse('2026-09-27T00:00:00Z');
 for(const metadata of [{},{plan:'pro'},{plan:'pro',proExpiresAt:'invalid'},{plan:'pro',proExpiresAt:'2026-09-26'},{plan:'free',proExpiresAt:'2027-01-01'}]) assert.equal(resolvePlan(metadata,now),'free');
 assert.equal(resolvePlan({plan:'pro',proExpiresAt:'2027-01-01'},now),'pro');
 assert.equal(resolvePlan({plan:'pro',proExpiresAt:'2026-09-27T00:00:00Z'},now),'free');
});

import {csvCell, memberCsv} from '../lib/membership/csv.ts';
test('member exports escape CSV and neutralize spreadsheet formulas',()=>{
 assert.equal(csvCell('A,"B"'), '"A,""B"""');
 for(const value of ['=1+1',' +SUM(A1)','\t@IMPORT','-1']) assert.ok(csvCell(value).startsWith('"\''));
 assert.equal(memberCsv([['名前','プラン']]), '\uFEFF"名前","プラン"');
});
