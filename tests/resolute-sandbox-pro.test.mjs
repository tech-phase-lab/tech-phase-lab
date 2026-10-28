import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSandboxPro } from '../lib/resolute/sandbox-pro.ts';
import { OWNER_ACCOUNT_ID } from '../lib/membership/entitlements.ts';
const now=Date.parse('2026-10-16T00:00:00Z');
function fixture() {
 const user={id:'user_test',banned:false,locked:false,primaryEmailAddressId:'email_test',emailAddresses:[{id:'email_test',verification:{status:'verified'}}],privateMetadata:{other:'keep'}};
 const writes=[];
 return {user,writes,args:{actor:OWNER_ACCOUNT_ID,now,env:{VERCEL_ENV:'preview',RESOLUTE_SANDBOX_TEST_USER_ID:'user_test',RESOLUTE_SANDBOX_TEST_UNTIL:'2026-10-18T15:00:00.000Z'},
 read:async id=>{assert.equal(id,user.id);return user;},write:async(id,meta)=>{writes.push({id,meta});Object.assign(user.privateMetadata,meta);}}};
}
test('owner prepares only the configured tester, verifies the write, and repeat does not extend or rewrite',async()=>{
 const f=fixture();assert.equal((await prepareSandboxPro(f.args)).ok,true);
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].id,'user_test');assert.equal(f.user.privateMetadata.other,'keep');
 assert.equal(f.user.privateMetadata.proExpiresAt,f.args.env.RESOLUTE_SANDBOX_TEST_UNTIL);
 assert.equal((await prepareSandboxPro(f.args)).repeated,true);assert.equal(f.writes.length,1);
});
test('tester, arbitrary member, anonymous, production, owner as target, expired and excessively long setup all fail closed',async()=>{
 for(const actor of [null,'user_test','user_other']) {const f=fixture();await assert.rejects(prepareSandboxPro({...f.args,actor}));assert.equal(f.writes.length,0);}
 for(const overrides of [{VERCEL_ENV:'production'},{RESOLUTE_SANDBOX_TEST_USER_ID:OWNER_ACCOUNT_ID},{RESOLUTE_SANDBOX_TEST_USER_ID:''},{RESOLUTE_SANDBOX_TEST_UNTIL:'2026-10-16T00:00:00.000Z'},{RESOLUTE_SANDBOX_TEST_UNTIL:'2027-01-01T00:00:00.000Z'}]){
 const f=fixture();await assert.rejects(prepareSandboxPro({...f.args,env:{...f.args.env,...overrides}}));assert.equal(f.writes.length,0);}
});
test('existing membership and ineligible identities are never changed',async()=>{
 for(const meta of [{plan:'pro',proExpiresAt:'2027-01-01T00:00:00Z'},{plan:'paid'},{role:'admin'},{proExpiresAt:'2027-01-01T00:00:00Z'}]){
 const f=fixture();f.user.privateMetadata=meta;await assert.rejects(prepareSandboxPro(f.args));assert.equal(f.writes.length,0);}
 for(const change of [{locked:true},{banned:true},{primaryEmailAddressId:'other'},{id:'user_wrong'}]){
 const f=fixture();Object.assign(f.user,change);await assert.rejects(prepareSandboxPro({...f.args,read:async()=>f.user}));assert.equal(f.writes.length,0);}
});
test('write errors or failed read-back never report success',async()=>{
 const f=fixture();await assert.rejects(prepareSandboxPro({...f.args,write:async()=>{throw Error('offline');}}));
 await assert.rejects(prepareSandboxPro({...f.args,write:async()=>{}}),/VERIFY_FAILED/);
});
