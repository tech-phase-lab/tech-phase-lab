import assert from 'node:assert/strict';
import test from 'node:test';
import {safeAccountReturn,readAccountReturn} from '../lib/research/account-return.ts';
test('return destinations preserve internal article hashes and search parameters only',()=>{
 for(const value of ['/research#what-changed/mu-q3-2026','/research/stocks?q=MU','/research/notifications']) assert.equal(safeAccountReturn(value),value);
 for(const value of ['https://evil.test','//evil.test','/research-other','/research/../resolute','/research/account','/research/account/sign-up#/sso-callback','/research\\evil','/research\n',null]) assert.equal(safeAccountReturn(value),null);
});
test('invalid, stale, future and unavailable storage safely falls back to the account',()=>{
 const now=10000000;
 const storage=value=>({getItem:()=>value});
 assert.equal(readAccountReturn(storage(JSON.stringify({path:'/research#saved',at:now})),now),'/research#saved');
 for(const value of [null,'broken','{}',JSON.stringify({path:'//evil.test',at:now}),JSON.stringify({path:'/research',at:now-1800001}),JSON.stringify({path:'/research',at:now+1})]) assert.equal(readAccountReturn(storage(value),now),'/research/account');
 assert.equal(readAccountReturn({getItem(){throw Error('blocked');}},now),'/research/account');
});
