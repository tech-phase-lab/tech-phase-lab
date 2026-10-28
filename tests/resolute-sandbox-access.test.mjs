import test from 'node:test';
import assert from 'node:assert/strict';
import {sandboxTester} from '../lib/resolute/sandbox-access.ts';
import {paymentHttp} from '../services/resolute-api/payments/http.mjs';

test('sandbox tester admission requires one exact ID and a future expiry',()=>{
 const now=Date.parse('2026-10-16T00:00:00.000Z');
 const env={RESOLUTE_SANDBOX_TEST_USER_ID:'user_test',RESOLUTE_SANDBOX_TEST_UNTIL:'2026-10-17T00:00:00.000Z'};
 assert.equal(sandboxTester(env,now),'user_test');
 assert.equal(sandboxTester(env,Date.parse(env.RESOLUTE_SANDBOX_TEST_UNTIL)),null);
 for(const id of ['', '*', 'user_a,user_b','user_a user_b']) assert.equal(sandboxTester({...env,RESOLUTE_SANDBOX_TEST_USER_ID:id},now),null);
 for(const until of ['', 'never','2099','not-a-date']) assert.equal(sandboxTester({...env,RESOLUTE_SANDBOX_TEST_UNTIL:until},now),null);
 assert.equal(sandboxTester({},now),null);
});

test('tester admission is rechecked on each request and audit remains owner-only',async()=>{
 let user='user_test',allowed=true,auditCalls=0;
 const handler=paymentHttp({enabled:true,authenticate:async()=>user,
  allowedUsers:()=>['user_owner',...(allowed?['user_test']:[])],auditUsers:['user_owner'],
  store:{auditList:async()=>{auditCalls++;return [];}},engine:{status:async()=>({state:'created'})}});
 const order=()=>new Request('https://internal.test/internal/v1/payments/orders/12345678-1234-1234-1234-123456789012');
 const audit=()=>new Request('https://internal.test/internal/v1/payments/audit');
 assert.equal((await handler(order())).status,200);
 assert.equal((await handler(audit())).status,403);assert.equal(auditCalls,0);
 allowed=false;assert.equal((await handler(order())).status,403);
 user='user_other';assert.equal((await handler(order())).status,403);
 user='user_owner';assert.equal((await handler(audit())).status,200);assert.equal(auditCalls,1);
});
