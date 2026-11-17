// Nov 17 (owner): the demo price-target notice for filming the PRO video. Owner only (both owner accounts, every environment), refused
// for everyone else before the monitor, and the text shown on the owner's panel is exactly what the monitor sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath} from 'node:url';
import {OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';
import {DEMO_LANGUAGES, DEMO_PRICE_TARGET, demoPriceTargetText} from '../lib/research/push-demo-notice.ts';

const source = readFileSync(new URL('../app/api/research/notifications/route.ts', import.meta.url), 'utf8')
  .replace('import { getMembership } from "@/lib/membership/server";', 'const getMembership = async () => globalThis.__demoMember;')
  .replace('"@/lib/membership/entitlements"', JSON.stringify(new URL('../lib/membership/entitlements.ts', import.meta.url).href))
  .replace('"@/lib/research/push-diagnostic"', JSON.stringify(new URL('../lib/research/push-diagnostic.ts', import.meta.url).href))
  .replace('"@/lib/research/push-send-log"', JSON.stringify(new URL('../lib/research/push-send-log.ts', import.meta.url).href))
  .replace('"@/lib/research/push-server-notice"', JSON.stringify(new URL('../lib/research/push-server-notice.ts', import.meta.url).href));
const {POST} = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));

const subscription = {endpoint: 'https://web.push.apple.com/owner-phone', keys: {p256dh: 'p', auth: 'a'}};
const request = (body, origin = 'https://techphase.app') => new Request('https://techphase.app/api/research/notifications', {
  method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify(body)});
const owner = (userId, extra = {}) => ({status: 'signed-in', plan: 'pro', userId, isAdmin: true, ownerMode: true, accessExpiresAt: Date.now() + 3_600_000, ...extra});

async function withMonitor(run) {
  const saved = {fetch: globalThis.fetch, url: process.env.RESEARCH_MONITOR_URL, token: process.env.RESEARCH_MONITOR_TOKEN, env: process.env.VERCEL_ENV};
  process.env.RESEARCH_MONITOR_URL = 'https://monitor.example'; process.env.RESEARCH_MONITOR_TOKEN = 'fixture-token';
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : null});
    return Response.json({ok: true, accepted: true, expired: false, providerStatus: 201, failureKind: null, registered: true}); };
  try { await run(calls); } finally {
    globalThis.fetch = saved.fetch; delete globalThis.__demoMember;
    for (const [key, value] of [['RESEARCH_MONITOR_URL', saved.url], ['RESEARCH_MONITOR_TOKEN', saved.token], ['VERCEL_ENV', saved.env]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('both owner accounts in owner mode send one demo notice in Japanese or English, in every environment, with the owner flag', async () => {
  await withMonitor(async calls => {
    for (const environment of ['production', 'preview', 'development', undefined]) {
      if (environment === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = environment;
      for (const id of [OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID]) for (const language of ['ja', 'en']) {
        globalThis.__demoMember = owner(id);
        const response = await POST(request({action: 'demo-target', language, subscription, memberId: 'user_someone_else'}));
        assert.equal(response.status, 200, `${environment} ${id} ${language}`);
        assert.deepEqual(await response.json(), {ok: true, accepted: true, expired: false, providerStatus: 201});
        const sent = calls.at(-1);
        assert.equal(sent.url, 'https://monitor.example/push/member/demo-target');
        assert.equal(sent.headers['X-Push-Owner-Demo'], '1');
        assert.equal(sent.headers.Authorization, 'Bearer fixture-token');
        // Only the verified member id, this device and the language: nothing else from the request.
        assert.deepEqual(sent.body, {memberId: id, subscription, language});
      }
    }
    assert.equal(calls.length, 16);
  });
});

test('members, FREE, signed-out and an owner outside owner mode are refused before the monitor', async () => {
  await withMonitor(async calls => {
    const refused = [
      [{status: 'signed-out', plan: 'free'}, 401],
      [{status: 'unavailable', plan: 'free'}, 503],
      [{status: 'signed-in', plan: 'free', userId: 'user_free', isAdmin: false, ownerMode: false, accessExpiresAt: 0}, 403],
      [{status: 'signed-in', plan: 'pro', userId: 'user_member', isAdmin: false, ownerMode: false, accessExpiresAt: Date.now() + 60_000}, 403],
      // An admin in a preview owner mode that is not an owner account.
      [owner('user_preview_admin'), 403],
      // An owner account previewing a member plan, or without the admin check (second factor).
      [owner(PRODUCTION_OWNER_ACCOUNT_ID, {ownerMode: false}), 403],
      [owner(OWNER_ACCOUNT_ID, {isAdmin: false}), 403],
    ];
    for (const [member, status] of refused) {
      globalThis.__demoMember = member;
      for (const forged of [{}, {ownerMode: true, isAdmin: true, owner: true, 'X-Push-Owner-Demo': '1'}]) {
        const response = await POST(request({action: 'demo-target', language: 'ja', subscription, ...forged}));
        assert.equal(response.status, status, JSON.stringify(member));
        if (status === 403) assert.equal((await response.json()).error, 'owner-required');
      }
    }
    globalThis.__demoMember = owner(PRODUCTION_OWNER_ACCOUNT_ID);
    assert.equal((await POST(request({action: 'demo-target', language: 'ja', subscription}, 'https://attacker.test'))).status, 403);
    for (const language of ['fr', '', undefined, 'JA']) {
      const response = await POST(request({action: 'demo-target', language, subscription}));
      assert.equal(response.status, 400); assert.equal((await response.json()).error, 'invalid-language');
    }
    assert.equal(calls.length, 0, 'nothing reached the monitor');
    // The owner's other requests never carry the owner flag.
    await POST(request({action: 'test', subscription}));
    assert.equal(calls.length, 1); assert.equal(calls[0].headers['X-Push-Owner-Demo'], undefined);
  });
});

test("the monitor's one-minute answer and its refusals reach the owner's panel", async () => {
  await withMonitor(async () => {
    globalThis.__demoMember = owner(OWNER_ACCOUNT_ID);
    globalThis.fetch = async () => Response.json({ok: true, accepted: false, retryAfter: 60});
    assert.deepEqual(await (await POST(request({action: 'demo-target', language: 'en', subscription}))).json(),
      {ok: true, accepted: false, expired: false, retryAfter: 60, providerStatus: 0});
    globalThis.fetch = async () => Response.json({ok: false, error: 'not-registered'}, {status: 400});
    assert.deepEqual(await (await POST(request({action: 'demo-target', language: 'en', subscription}))).json(), {ok: false, error: 'not-registered'});
  });
});

test("the panel's preview is exactly the text the monitor sends (the real price-target format)", () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const script = 'import json,sys; sys.path.insert(0,"scripts/research"); import web_push as p; d=p.DEMO_TARGET; ' +
    'print(json.dumps({"target": d, "texts": {l: p.price_target_payload(d["ticker"], d["firm"], d["previous"], d["latest"], l == "ja", "t") for l in ("ja", "en")}}))';
  const python = JSON.parse(execFileSync('python3', ['-c', script], {cwd: root, encoding: 'utf8'}));
  assert.deepEqual(python.target, {...DEMO_PRICE_TARGET});
  assert.deepEqual(DEMO_LANGUAGES, ['ja', 'en']);
  for (const language of DEMO_LANGUAGES) {
    const {title, body, url} = python.texts[language];
    assert.deepEqual(demoPriceTargetText(language), {title, body});
    assert.equal(url, '/research/price-targets');
  }
  assert.deepEqual(demoPriceTargetText('ja'), {title: 'NVDA · 目標株価の変更', body: 'Sample Securities: $295 → $340'});
  assert.deepEqual(demoPriceTargetText('en'), {title: 'NVDA · Price target update', body: 'Sample Securities: $295 → $340'});
});

test('the owner section has the heading, both buttons and the preview, and sends this device only', () => {
  const panel = readFileSync(new URL('../app/research/push-demo-panel.tsx', import.meta.url), 'utf8');
  for (const text of ['動画撮影用：目標株価のデモ通知', '日本語で送る', '英語で送る', 'demoPriceTargetText(language)', 'action: "demo-target"', 'subscription.toJSON()']) {
    assert.ok(panel.includes(text), text);
  }
  const settings = readFileSync(new URL('../app/research/notification-settings.tsx', import.meta.url), 'utf8');
  assert.match(settings, /demo=\{ownerMode && ownerAccount \? <PushDemoPanel lang=\{lang\} on=\{shownState === "on"\} \/> : null\}/);
});
