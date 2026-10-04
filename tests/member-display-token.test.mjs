import test from 'node:test';
import assert from 'node:assert/strict';
import { signDisplay, verifyDisplay } from '../lib/membership/display-token.ts';
const now=1000000, secret='test-only-key';
const pro={plan:'pro',owner:true,ownerMode:true,accessExpiresAt:now+600000};
test('verified display is bound to identity, signature and expiry',()=>{
 const token=signDisplay(pro,'owner',secret,now);
 assert.deepEqual(verifyDisplay(token,'owner',secret,now),pro);
 assert.equal(verifyDisplay(token,'other',secret,now),undefined);
 assert.equal(verifyDisplay(token,'owner','wrong',now),undefined);
 assert.equal(verifyDisplay(token,'owner',secret,now+300000),undefined);
 assert.equal(verifyDisplay(token+'x','owner',secret,now),undefined);
});
test('FREE owner preview remains FREE and PRO cannot outlive entitlement',()=>{
 const free={...pro,plan:'free',ownerMode:false};
 assert.equal(verifyDisplay(signDisplay(free,'owner',secret,now),'owner',secret,now).plan,'free');
 const short={...pro,accessExpiresAt:now+1000};
 assert.equal(verifyDisplay(signDisplay(short,'owner',secret,now),'owner',secret,now+1000),undefined);
});
