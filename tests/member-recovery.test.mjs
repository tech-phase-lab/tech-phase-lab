import test from "node:test";
import assert from "node:assert/strict";
import { recoverMember } from "../lib/research/member-recovery.ts";

test("resume awaits session renewal before server membership lookup", async t => {
  const calls = []; let release;
  const ready = new Promise(resolve => { release = resolve; });
  t.mock.method(globalThis, "fetch", async () => { calls.push("read"); return Response.json({status:"signed-in",isAdmin:true,plan:"pro"}); });
  const pending = recoverMember(async force => { calls.push(force); await ready; }, new AbortController().signal, true);
  assert.deepEqual(calls, [true]); release();
  const {member} = await pending; assert.deepEqual(calls, [true,"read"]); assert.equal(member.isAdmin,true);
});
test("stale signed-out response triggers one forced renewal and uses verified result", async t => {
  let calls = 0; const refreshes = [];
  t.mock.method(globalThis, "fetch", async () => Response.json(++calls === 1 ? {status:"signed-out",plan:"free"} : {status:"signed-in",plan:"pro",isAdmin:false}));
  const {member} = await recoverMember(async force => {refreshes.push(force);},new AbortController().signal);
  assert.equal(calls,2); assert.deepEqual(refreshes,[false,true]); assert.equal(member.isAdmin,false);
});
test("real signed-out session stays signed-out without an endless retry or privilege grant", async t => {
  let calls=0; t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({status:"signed-out",plan:"free"});});
  const {member}=await recoverMember(async()=>{},new AbortController().signal);
  assert.equal(calls,2);assert.equal(member.status,"signed-out");assert.equal(member.plan,"free");
});
test("failed renewal and cancelled resume cannot issue a membership request", async t => {
  let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({});});
  await assert.rejects(recoverMember(async()=>{throw Error("offline");},new AbortController().signal));
  const c=new AbortController();c.abort();
  await assert.rejects(recoverMember(async()=>{},c.signal));assert.equal(calls,0);
});
