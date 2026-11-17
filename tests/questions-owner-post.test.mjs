import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { transform } from 'esbuild';
import { OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID } from '../lib/membership/entitlements.ts';

// Owner, Nov 16: the owner posts sample questions in リゼルに聞く from the same ask bar, without the daily limit.
const require = createRequire(import.meta.url);
const question = id => ({ id, body: '決算で最初に見る数字を教えてください。', status: 'pending', answerPostId: null, createdAt: '2026-11-16T00:00:00.000Z', isMine: true });

function renderQuestions({ ownerMode, ownerAccount = ownerMode, open = false, left = 1, items = [] }) {
  let index = 0;
  const react = require('react');
  const values = { 0: items, 5: left, 6: 'ready', 7: open };
  const stubs = {
    react: { ...react, useEffect: () => {}, useState: initial => { const at = index++; return [at in values ? values[at] : initial, () => {}]; } },
    'next/link': { default: ({ children, ...props }) => createElement('a', props, children) },
    'next/image': { default: props => createElement('img', { alt: props.alt, src: props.src }) },
    '../identity-provider': { useIdentityRefresh: () => async () => {} },
    '../research-tool-shell': { default: ({ children }) => createElement('main', null, children) },
    '../use-research-language': { useResearchLanguage: () => ['ja', () => {}] },
    '../member-display-provider': { useOwnerMode: () => ownerMode, useOwnerAccount: () => ownerAccount },
  };
  const out = ts.transpileModule(readFileSync(new URL('../app/research/qa/questions.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', out)(id => id.endsWith('.module.css') ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : id in stubs ? stubs[id] : require(id), mod, mod.exports);
  return renderToStaticMarkup(createElement(mod.exports.default));
}

test('the owner gets the same ask bar and panel as members, with no day count, and keeps the owner tools on their own question', () => {
  const memberBar = renderQuestions({ ownerMode: false });
  assert.match(memberBar, /リゼルに質問する/); assert.match(memberBar, /今日あと 1 件/);
  const ownerBar = renderQuestions({ ownerMode: true, left: 0 });
  assert.match(ownerBar, /リゼルに質問する/, 'the owner sees the ask bar');
  assert.doesNotMatch(ownerBar, /今日あと|今日は終わりました/, 'no day count for the owner');
  assert.doesNotMatch(ownerBar, /<button[^>]*disabled=""[^>]*><span[^>]*askBarIcon/, 'the bar is not disabled for the owner even when the member count is used up');
  const ownerPanel = renderQuestions({ ownerMode: true, open: true, left: 0 });
  assert.match(ownerPanel, /aria-label="質問"/); assert.match(ownerPanel, /投稿/);
  assert.doesNotMatch(ownerPanel, /今日あと/); assert.match(ownerPanel, /運営者の投稿には、1日の件数の上限はありません/);
  assert.doesNotMatch(ownerPanel, /1日2件まで/);
  const memberPanel = renderQuestions({ ownerMode: false, open: true, left: 2 });
  assert.match(memberPanel, /今日あと 2 件/); assert.match(memberPanel, /1日2件まで/);
  const ownCard = renderQuestions({ ownerMode: true, items: [question('q-' + 'a'.repeat(32))] });
  for (const text of ['あなたの質問', '回答する', 'この質問を削除']) assert.ok(ownCard.includes(text), text);
  const memberCard = renderQuestions({ ownerMode: false, items: [{ ...question('q-' + 'b'.repeat(32)), isMine: false }] });
  assert.doesNotMatch(memberCard, /回答する|あなたの質問|運営者/, 'other members see no author and no owner mark on the card');
});

async function ownerRoute() {
  let membership = readFileSync(new URL('../lib/membership/server.ts', import.meta.url), 'utf8')
    .replace('import "server-only";', '')
    .replace('import {liveMembership} from "@/services/tech-phase-billing/live-membership.mjs";', 'const liveMembership=async()=>globalThis.__ownerPost.live;')
    .replace('import { cache } from "react";', 'const cache=fn=>fn;')
    .replace('import { auth, clerkClient } from "@clerk/nextjs/server";', 'const auth=async()=>globalThis.__ownerPost.session;const clerkClient=async()=>({users:{getUser:async()=>globalThis.__ownerPost.user}});');
  for (const name of ['entitlements', 'admin-mfa']) membership = membership.replace(`"./${name}"`, JSON.stringify(new URL(`../lib/membership/${name}.ts`, import.meta.url).href));
  const { getMembership } = await import('data:text/javascript;base64,' + Buffer.from((await transform(membership, { loader: 'ts', format: 'esm' })).code).toString('base64'));
  globalThis.__ownerPostMembership = getMembership;
  const route = readFileSync(new URL('../app/api/research/questions/route.ts', import.meta.url), 'utf8')
    .replace('import { getMembership } from "@/lib/membership/server";', 'const getMembership = (...args) => globalThis.__ownerPostMembership(...args);');
  return import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(route)).toString('base64'));
}

test('owner access: both owner accounts post through the route with the server-derived owner flag in every environment; members cannot set it', async () => {
  const { POST } = await ownerRoute();
  const keys = ['CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'TECH_PHASE_REQUIRE_ADMIN_MFA', 'VERCEL_ENV', 'RESEARCH_MONITOR_URL', 'RESEARCH_MONITOR_TOKEN'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]])), savedFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ ok: true, item: { id: 'q-' + '1'.repeat(32) }, left: null }); };
  const ask = (extra = {}, headers = {}) => new Request('https://example.test/api/research/questions', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json', ...headers }, body: JSON.stringify({ audience: 'pro-board', requestId: 'q-' + '1'.repeat(32), body: 'サンプル用に運営者が書く質問です。', ...extra }) });
  try {
    Object.assign(process.env, { CLERK_SECRET_KEY: 'fixture', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'fixture', TECH_PHASE_REQUIRE_ADMIN_MFA: 'true', RESEARCH_MONITOR_URL: 'https://monitor.example', RESEARCH_MONITOR_TOKEN: 'monitor-token-at-least-24-characters' });
    for (const environment of ['production', 'preview', 'development']) for (const owner of [OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID]) {
      process.env.VERCEL_ENV = environment;
      globalThis.__ownerPost = { live: { plan: 'free', accessExpiresAt: 0 }, session: { userId: owner, sessionClaims: { fva: [0, 0] } }, user: { twoFactorEnabled: true, privateMetadata: {} } };
      const response = await POST(ask());
      assert.equal(response.status, 200, `${environment} ${owner}`);
      const sent = calls.at(-1);
      assert.equal(sent.init.headers['X-Question-Owner-Post'], '1', `${environment} ${owner}`);
      assert.deepEqual(Object.keys(JSON.parse(sent.init.body)).sort(), ['audience', 'body', 'ownerKey', 'requestId']);
      assert.doesNotMatch(JSON.stringify(sent), new RegExp(owner), 'the owner account id never reaches the monitor');
    }
    // An ordinary PRO member (even an admin role, even sending owner-looking fields or headers) never gets the flag.
    process.env.VERCEL_ENV = 'production';
    globalThis.__ownerPost = { live: { plan: 'pro', accessExpiresAt: Date.now() + 600000 }, session: { userId: 'user_other', sessionClaims: { fva: [0, 0] } }, user: { twoFactorEnabled: true, privateMetadata: { role: 'admin' } } };
    for (const request of [ask(), ask({ ownerPost: true, ownerMode: true, owner_post: true }, { 'X-Question-Owner-Post': '1' })]) {
      assert.equal((await POST(request)).status, 200);
      const sent = calls.at(-1);
      assert.equal(sent.init.headers['X-Question-Owner-Post'], undefined);
      assert.deepEqual(Object.keys(JSON.parse(sent.init.body)).sort(), ['audience', 'body', 'ownerKey', 'requestId']);
    }
    // A free member is still refused before the monitor is called.
    globalThis.__ownerPost.live = { plan: 'free', accessExpiresAt: 0 };
    const count = calls.length;
    assert.equal((await POST(ask({ ownerPost: true }))).status, 403); assert.equal(calls.length, count);
  } finally {
    globalThis.fetch = savedFetch; delete globalThis.__ownerPost; delete globalThis.__ownerPostMembership;
    for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
  }
});

test('owner previewing the PRO member plan: the board comes back with no 「自分の質問」 mark, so no 「あなたの質問」 or delete shows', async () => {
  const { GET } = await ownerRoute();
  const keys = ['CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'TECH_PHASE_REQUIRE_ADMIN_MFA', 'VERCEL_ENV', 'RESEARCH_MONITOR_URL', 'RESEARCH_MONITOR_TOKEN'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]])), savedFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ok: true, audience: 'pro-board', items: [{ id: 'q-' + 'd'.repeat(32), body: 'x', status: 'answered', isMine: true }], hasNext: false, limit: 2, left: 1 });
  const preview = { membershipPreview: { plan: 'pro', proExpiresAt: new Date(Date.now() + 3600000).toISOString(), testUntil: new Date(Date.now() + 3600000).toISOString() } };
  const mine = async () => (await (await GET(new Request('https://example.test/api/research/questions?page=1'))).json()).items[0].isMine;
  try {
    Object.assign(process.env, { CLERK_SECRET_KEY: 'fixture', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'fixture', TECH_PHASE_REQUIRE_ADMIN_MFA: 'true', RESEARCH_MONITOR_URL: 'https://monitor.example', RESEARCH_MONITOR_TOKEN: 'monitor-token-at-least-24-characters' });
    // The production owner previewing PRO on techphase.app (production owner previews run as "preview").
    process.env.VERCEL_ENV = 'production';
    globalThis.__ownerPost = { live: { plan: 'free', accessExpiresAt: 0 }, session: { userId: PRODUCTION_OWNER_ACCOUNT_ID, sessionClaims: { fva: [0, 0] } }, user: { twoFactorEnabled: true, privateMetadata: preview } };
    assert.equal(await mine(), false, 'owner previewing PRO');
    // The owner view keeps the mark.
    globalThis.__ownerPost.user = { twoFactorEnabled: true, privateMetadata: {} };
    assert.equal(await mine(), true, 'owner view');
    // An ordinary PRO member keeps the mark on their own question.
    globalThis.__ownerPost = { live: { plan: 'pro', accessExpiresAt: Date.now() + 600000 }, session: { userId: 'user_other', sessionClaims: { fva: [0, 0] } }, user: { twoFactorEnabled: true, privateMetadata: {} } };
    assert.equal(await mine(), true, 'member');
  } finally {
    globalThis.fetch = savedFetch; delete globalThis.__ownerPost; delete globalThis.__ownerPostMembership;
    for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
  }
});

test('the owner account viewing as a PRO member sees its own card like any other member (no 「あなたの質問」, no delete) for screenshots', () => {
  const answered = { ...question('q-' + 'c'.repeat(32)), status: 'answered' };
  const preview = renderQuestions({ ownerMode: false, ownerAccount: true, items: [answered] });
  assert.doesNotMatch(preview, /あなたの質問|この質問を削除|回答する|運営者/);
  const member = renderQuestions({ ownerMode: false, ownerAccount: false, items: [answered] });
  assert.match(member, /あなたの質問/); assert.match(member, /この質問を削除/);
  const owner = renderQuestions({ ownerMode: true, items: [answered] });
  assert.match(owner, /あなたの質問/); assert.match(owner, /この質問を削除/);
});
