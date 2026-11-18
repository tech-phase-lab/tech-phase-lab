// Owner, Nov 18 (home-screen app, owner account): テーマランキング stayed on 「データを読み込み中…」 for over a minute.
// Reproduced: a refused request (401/403) left the screen on "loading" and waited for the membership display to flip, so it either
// stayed there for good or (when the display flipped back to PRO) asked again without end. Every request now ends on screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { fetchThemeData, THEME_REQUEST_MS } from '../lib/research/theme-fetch.ts';

const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const OK = { ok: true, group: 'all', stocks: [{ ticker: 'NVDA', returns: { '1d': 1.2 } }], asOf: '2026-11-17', fetchedAt: 5, marketOpen: false, validUntil: Date.now() + 3_600_000 };
function server(answers) {
  const calls = [], refreshes = [];
  let index = 0;
  return {
    calls, refreshes,
    fetch: async (url, init) => { calls.push(url); assert.equal(init.cache, 'no-store'); const next = answers[Math.min(index++, answers.length - 1)]; if (next instanceof Error) throw next; return next; },
    refresh: async force => { refreshes.push(force); },
  };
}
const run = (s, signal = new AbortController().signal) => fetchThemeData('all', { fetch: s.fetch, refresh: s.refresh, signal });

test('a normal answer is ready, after renewing the session first', async () => {
  const s = server([json(200, OK)]);
  const outcome = await run(s);
  assert.equal(outcome.kind, 'ready');
  assert.deepEqual(outcome.data.stocks, OK.stocks);
  assert.equal(outcome.data.asOf, '2026-11-17');
  assert.deepEqual(s.calls, ['/api/research/themes?group=all']);
  assert.deepEqual(s.refreshes, [false]);
});

test('an expired session (401 on the first try) is renewed and asked once more', async () => {
  const s = server([json(401, { ok: false, error: 'sign-in' }), json(200, OK)]);
  assert.equal((await run(s)).kind, 'ready');
  assert.equal(s.calls.length, 2);
  assert.deepEqual(s.refreshes, [false, true], 'the second try uses a freshly issued token');
});

test('a refusal that persists ends in a refusal, after exactly two requests (never a loop, never loading)', async () => {
  let s = server([json(401, { ok: false, error: 'sign-in' })]);
  assert.deepEqual(await run(s), { kind: 'denied', reason: 'sign-in' });
  assert.equal(s.calls.length, 2);
  s = server([json(403, { ok: false, error: 'pro-required' })]);
  assert.deepEqual(await run(s), { kind: 'denied', reason: 'pro-required' });
  assert.equal(s.calls.length, 2);
});

test('not connected, server errors, gateway pages, bad bodies and network failures each end in a state', async () => {
  assert.equal((await run(server([json(503, { ok: false, error: 'not-connected' })]))).kind, 'not-connected');
  assert.equal((await run(server([json(503, { ok: false, error: 'unavailable' })]))).kind, 'error');
  assert.equal((await run(server([{ status: 504, ok: false, json: async () => { throw new SyntaxError('html'); } }]))).kind, 'error');
  assert.equal((await run(server([json(200, { ok: true, stocks: 'x' })]))).kind, 'error');
  assert.equal((await run(server([new TypeError('Load failed')]))).kind, 'error');
});

test('a session helper that is still starting (or fails) does not hold the request back', async () => {
  const s = server([json(200, OK)]);
  s.refresh = async () => { throw new Error('identity-loading'); };
  assert.equal((await run(s)).kind, 'ready');
});

test('an abort (leaving the screen, or the time limit) is passed on, not shown as data', async () => {
  const controller = new AbortController();
  const s = server([json(200, OK)]);
  const pending = fetchThemeData('all', { fetch: async (url, init) => { controller.abort(); return s.fetch(url, init); }, refresh: s.refresh, signal: controller.signal });
  await assert.rejects(pending);
  assert.ok(THEME_REQUEST_MS < 60_000, 'the browser gives up before the server limit');
});

// The hook itself, mounted: state after each kind of answer, and the membership re-check asked for at most once.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'https://example.test' });
for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
async function loadParts() {
  const dir = await mkdtemp(new URL('../.theme-ui-', import.meta.url));
  try {
    const outfile = `${dir}/parts.mjs`;
    await build({ entryPoints: [new URL('../app/research/themes/parts.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', outfile, plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /^react$/, namespace: 'stub' }, () => ({ path: 'react', external: true }));
      b.onResolve({ filter: /^next\/link$|\/identity-provider$/ }, args => ({ path: args.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: args.path === 'next/link' ? `import React from 'react';export default function Link(p){return React.createElement('a',{href:p.href},p.children)}` : `export const useIdentityRefresh=()=>globalThis.__themeRefresh;` }));
      b.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default new Proxy({}, {get: (_, key) => key})', loader: 'js' }));
    } }] });
    return await import(pathToFileURL(outfile).href);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const parts = await loadParts();

async function mount(answers, plan = 'pro') {
  const s = server(answers);
  const original = globalThis.fetch;
  globalThis.fetch = s.fetch;
  globalThis.__themeRefresh = s.refresh;
  let announced = 0;
  const count = () => { announced++; };
  window.addEventListener('tech-phase:membership-changed', count);
  const seen = [];
  let api;
  function Probe({ plan }) { api = parts.useThemeData('all', plan); seen.push(api.state); return React.createElement('p', null, api.state); }
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(Probe, { plan })); await tick(); });
  return {
    s, seen, host, get state() { return api.state; }, get data() { return api.data; }, get announced() { return announced; },
    rerender: async next => { await act(async () => { root.render(React.createElement(Probe, { plan: next })); await tick(); }); },
    retry: async () => { await act(async () => { api.retry(); await tick(); }); },
    unmount: async () => { await act(async () => root.unmount()); host.remove(); globalThis.fetch = original; window.removeEventListener('tech-phase:membership-changed', count); },
  };
}

test('mounted: data arrives and the screen is ready', async () => {
  const m = await mount([json(200, OK)]);
  try { assert.equal(m.state, 'ready'); assert.equal(m.data.stocks[0].ticker, 'NVDA'); assert.equal(m.announced, 0); } finally { await m.unmount(); }
});

test('mounted: a lasting refusal leaves loading for a clear message, asks the membership display once, and does not loop', async () => {
  const m = await mount([json(403, { ok: false, error: 'pro-required' })]);
  try {
    assert.equal(m.state, 'pro-required');
    assert.equal(m.announced, 1);
    // The membership display re-checks: PRO → (checking) → PRO again. One more request, no second announcement, no loop.
    await m.rerender(null); await m.rerender('pro');
    assert.equal(m.state, 'pro-required');
    assert.equal(m.announced, 1);
    assert.equal(m.s.calls.length, 4);
    await tick(); await tick();
    assert.equal(m.s.calls.length, 4, 'nothing more is asked by itself');
    // The button asks again, and a new refusal may again ask the display to re-check once.
    await m.retry();
    assert.equal(m.s.calls.length, 6);
    assert.equal(m.announced, 2);
  } finally { await m.unmount(); }
});

test('mounted: an expired session recovers to data without the user doing anything', async () => {
  const m = await mount([json(401, { ok: false, error: 'sign-in' }), json(200, OK)]);
  try { assert.equal(m.state, 'ready'); assert.equal(m.announced, 0); } finally { await m.unmount(); }
});

test('mounted: an error can be retried into data', async () => {
  const m = await mount([json(503, { ok: false, error: 'unavailable' }), json(200, OK)]);
  try {
    assert.equal(m.state, 'error');
    await m.retry();
    assert.equal(m.state, 'ready');
  } finally { await m.unmount(); }
});

test('mounted: FREE never asks', async () => {
  const m = await mount([json(200, OK)], 'free');
  try { assert.equal(m.s.calls.length, 0); } finally { await m.unmount(); }
});

test('both theme screens show the refusal and error message with a retry button, never only "loading"', async () => {
  for (const file of ['screen', 'detail']) {
    const source = await readFile(new URL(`../app/research/themes/${file}.tsx`, import.meta.url), 'utf8');
    assert.match(source, /\(state === "error" \|\| state === "sign-in" \|\| state === "pro-required"\)[^\n]*<DataProblem state=\{state\} ja=\{ja\} onRetry=\{retry\} \/>/, file);
  }
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  let retried = 0;
  await act(async () => { root.render(React.createElement(parts.DataProblem, { state: 'sign-in', ja: true, onRetry: () => { retried++; } })); });
  assert.match(host.textContent, /ログインの確認ができませんでした/);
  await act(async () => { host.querySelector('button').click(); });
  assert.equal(retried, 1);
  await act(async () => root.unmount()); host.remove();
});
