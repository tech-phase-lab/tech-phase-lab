import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const hookSource = readFileSync(new URL('../app/research/use-member-article.ts', import.meta.url), 'utf8')
  .replace('import { useEffect, useState } from "react";', 'const {useEffect,useState} = globalThis.__articleResumeHooks;')
  .replace('import type { ResearchEvent } from "@/lib/research/data";', '');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function harness(t) {
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-10-02T00:00:00Z')});
  let state, cleanup;
  globalThis.__articleResumeHooks = {
    useState: initial => { state = initial; return [state, value => { state = typeof value === 'function' ? value(state) : value; }]; },
    useEffect: effect => { cleanup = effect(); },
  };
  const browser = new EventTarget(), document = Object.assign(new EventTarget(),{hidden:false});
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = browser; globalThis.document = document;
  const {useMemberArticle: mountArticle} = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(hookSource) + `\n// ${Math.random()}`).toString('base64'));
  t.after(() => { cleanup?.(); globalThis.window = oldWindow; globalThis.document = oldDocument; delete globalThis.__articleResumeHooks; });
  return {start:()=>mountArticle('note-1',true),state:()=>state,focus:()=>browser.dispatchEvent(new Event('focus')),visible:()=>document.dispatchEvent(new Event('visibilitychange')),changed:()=>browser.dispatchEvent(new Event('tech-phase:membership-changed'))};
}

test('resume keeps a valid article interactive, coalesces repeated events, and expires it during a slow renewal',async t=>{
  const h=await harness(t); let calls=0, release;
  const leaseEnd=Date.now()+90_000;
  t.mock.method(globalThis,'fetch',async()=>{
    if(++calls===1)return Response.json({event:{id:'note-1',title:'visible body'},validUntil:leaseEnd});
    return new Promise(resolve=>{release=resolve;});
  });
  h.start();await flush();assert.equal(h.state().status,'ready');
  h.focus();h.visible();assert.equal(calls,1);
  t.mock.timers.tick(30_001);h.focus();h.visible();h.focus();await flush();
  assert.equal(calls,2);assert.equal(h.state().status,'ready');assert.equal(h.state().event.title,'visible body');
  t.mock.timers.tick(60_000);assert.equal(h.state().event,undefined);assert.equal(h.state().status,'pro-required');
  release(new Response(null,{status:403}));await flush();assert.equal(h.state().event,undefined);
});

test('membership change clears a valid body immediately and a denied renewal cannot restore it',async t=>{
  const h=await harness(t);let calls=0, release;
  t.mock.method(globalThis,'fetch',async()=>++calls===1?Response.json({event:{id:'note-1'},validUntil:Date.now()+90_000}):new Promise(resolve=>{release=resolve;}));
  h.start();await flush();assert.equal(h.state().status,'ready');
  h.changed();assert.equal(h.state().status,'loading');assert.equal(h.state().event,undefined);
  release(new Response(null,{status:401}));await flush();assert.equal(h.state().status,'sign-in');assert.equal(h.state().event,undefined);
});
