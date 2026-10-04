import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { createNewsPoller } from '../lib/research/news-poller.ts';

const require = createRequire(import.meta.url);
const flush = () => new Promise(resolve => setImmediate(resolve));
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function clock() {
  let next = 1;
  const tasks = new Map();
  return {
    schedule(fn, delay) { const id = next++; tasks.set(id, { fn, delay }); return id; },
    cancel(id) { tasks.delete(id); },
    delays: () => [...tasks.values()].map(item => item.delay),
    async run() { const [id, task] = tasks.entries().next().value; tasks.delete(id); task.fn(); await flush(); },
  };
}
function environment() {
  const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible', hidden: false });
  return {
    hide() { document.visibilityState = 'hidden'; document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); },
    show() { document.visibilityState = 'visible'; document.hidden = false; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow')); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); },
    restore() { for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } },
  };
}
function componentHarness(path, timer) {
  let states = [], index = 0, effects = [], mounted = false, cleanup = [];
  const hooks = {
    useState(initial) { const id = index++; if (!(id in states)) states[id] = typeof initial === 'function' ? initial() : initial; return [states[id], value => { states[id] = typeof value === 'function' ? value(states[id]) : value; }]; },
    useRef: () => ({ current: null }),
    useEffect: effect => { if (!mounted) effects.push(effect); },
  };
  function load(file, withHooks = false) {
    const output = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', output)(name => {
      if (name.endsWith('.module.css')) return { default: {} };
      if (name === 'react') return withHooks ? { ...React, ...hooks } : React;
      if (name === '@/lib/research/news-poller') return { ...require('../lib/research/news-poller.ts'), createNewsPoller: options => createNewsPoller({ ...options, schedule: timer.schedule, cancel: timer.cancel }) };
      if (name.startsWith('@/lib/research/')) return require(`../lib/research/${name.slice('@/lib/research/'.length)}.ts`);
      if (name === './use-calendar-clock') return { useCalendarClock: () => Date.now() };
      if (name === './notification-settings') return { default: () => null };
      if (name.startsWith('./')) return { default: load(new URL(`${name}.tsx`, new URL(file, import.meta.url)).href) };
      return require(name);
    }, loaded, loaded.exports);
    return loaded.exports.default;
  }
  const Panel = load(path, true);
  return {
    render(props = {}) { index = 0; return renderToStaticMarkup(React.createElement(Panel, { lang: 'en', ...props })); },
    mount() { cleanup = effects.map(effect => effect()); mounted = true; effects = []; },
    unmount() { for (const stop of cleanup) stop?.(); mounted = false; cleanup = []; effects = []; states = []; },
  };
}
const analyst = { id: '12345', ticker: 'NVDA', firm: 'Example Research', action: 'top-pick', titleJa: '報道によると、Example ResearchがNVDAをトップピックに選定', titleEn: 'Reportedly, Example Research names NVDA a top pick', bodyJa: '報道によると、評価は据え置き。', bodyEn: 'Reportedly, the rating is unchanged.', publishedAt: '2026-10-02T08:09:10+09:00', observedAt: '2026-10-03T00:00:00.000Z' };
const feed = rows => ({ ok: true, enabled: false, items: [], analystUpdates: rows });
const target = { id: 1, source: 'X · Market reporters', url: 'https://x.com/wallstengine/status/101', publishedAt: '2026-10-02T10:00:00Z', observedAt: '2026-10-02T10:00:01Z', ticker: 'ASTS', firm: 'B. Riley', previous: 85, latest: 65 };

test('news resume immediately replaces a suspended request, preserves visible data, coalesces wake events and applies withdrawal', async () => {
  const env = environment(), timer = clock(), delayed = pending();
  const requests = [];
  globalThis.fetch = (url, options) => { const request = { url, ...options }; requests.push(request); return requests.length === 1 ? Promise.resolve(Response.json(feed([analyst]))) : requests.length === 2 ? delayed.promise : Promise.resolve(Response.json(feed([]))); };
  const panel = componentHarness('../app/research/news/general-news-panel.tsx', timer);
  try {
    assert.match(panel.render(), /Fetching news/); panel.mount(); await timer.run();
    assert.match(panel.render(), /Reportedly, the rating is unchanged/);
    await timer.run(); assert.equal(requests.length, 2);
    env.hide(); assert.equal(requests[1].signal.aborted, true); assert.deepEqual(timer.delays(), []);
    assert.match(panel.render(), /Reportedly, the rating is unchanged/); // Background cancellation is not a data failure.
    env.show(); assert.deepEqual(timer.delays(), [0]);
    assert.match(panel.render(), /Reportedly, the rating is unchanged/); assert.doesNotMatch(panel.render(), /Fetching news/);
    await timer.run(); assert.equal(requests.length, 3);
    assert.doesNotMatch(panel.render(), /Reportedly, the rating is unchanged|NVDA|Fetching news/);
    delayed.resolve(Response.json(feed([analyst]))); await flush();
    assert.doesNotMatch(panel.render(), /Reportedly, the rating is unchanged/); // An old response cannot resurrect withdrawn copy.
    assert.deepEqual(timer.delays(), [5000]);
  } finally { panel.unmount(); env.restore(); }
});

test('news current refresh failure clears invalidated display and old initial seed; retry recovers', async () => {
  const env = environment(), timer = clock(); let calls = 0;
  globalThis.fetch = async () => ++calls === 2 ? new Response('', { status: 503 }) : Response.json(feed([analyst]));
  const panel = componentHarness('../app/research/news/general-news-panel.tsx', timer);
  try {
    panel.render(); panel.mount(); await timer.run(); assert.match(panel.render(), /Reportedly, the rating is unchanged/);
    env.hide(); env.show(); await timer.run();
    assert.match(panel.render(), /News is unavailable/); assert.doesNotMatch(panel.render(), /Reportedly, the rating is unchanged/);
    panel.unmount(); assert.match(panel.render({ initialNews: { data: feed([analyst]), checkedAt: Date.now() - 1000 } }), /Fetching news/);
    panel.mount(); await timer.run(); assert.match(panel.render(), /Reportedly, the rating is unchanged/);
  } finally { panel.unmount(); env.restore(); }
});

test('price-target resume cancels the below-fold initial GET and starts one immediate replacement without waiting for SSE', async () => {
  const env = environment(), initial = pending(), resumed = pending(); const requests = [];
  globalThis.fetch = (url, options) => { requests.push({ url, ...options }); if (url.endsWith('/stream')) return new Promise(() => {}); return requests.filter(item => !item.url.endsWith('/stream')).length === 1 ? initial.promise : resumed.promise; };
  const panel = componentHarness('../app/research/price-targets-panel.tsx');
  try {
    assert.match(panel.render(), /Fetching price targets/); panel.mount();
    env.hide(); assert.equal(requests[0].signal.aborted, true);
    env.show();
    assert.equal(requests.filter(item => item.url === '/api/research/price-targets').length, 2);
    resumed.resolve(Response.json({ ok: true, items: [target] })); await flush();
    assert.match(panel.render(), /ASTS/); assert.doesNotMatch(panel.render(), /Fetching price targets/);
    initial.resolve(Response.json({ ok: true, items: [] })); await flush(); assert.match(panel.render(), /ASTS/);
  } finally { panel.unmount(); env.restore(); }
});

test('price-target data stays visible during resume and a valid empty update revokes it', async () => {
  const env = environment(), pendingRead = pending(); let calls = 0;
  globalThis.fetch = (url) => url.endsWith('/stream') ? new Promise(() => {}) : ++calls === 1 ? Promise.resolve(Response.json({ ok: true, items: [target] })) : pendingRead.promise;
  const panel = componentHarness('../app/research/price-targets-panel.tsx');
  try {
    panel.render(); panel.mount(); await flush(); assert.match(panel.render(), /ASTS/);
    env.hide(); env.show(); assert.match(panel.render(), /ASTS/); assert.doesNotMatch(panel.render(), /Fetching price targets/);
    pendingRead.resolve(Response.json({ ok: true, items: [] })); await flush();
    assert.doesNotMatch(panel.render(), /ASTS|Fetching price targets/); assert.match(panel.render(), /No matching price target posts/);
  } finally { panel.unmount(); env.restore(); }
});

test('price-target current failure warns about retained items and invalidates remount cache', async () => {
  const env = environment(); let calls = 0;
  globalThis.fetch = (url) => url.endsWith('/stream') ? new Promise(() => {}) : Promise.resolve(++calls === 1 ? Response.json({ ok: true, items: [target] }) : new Response('', { status: 503 }));
  const panel = componentHarness('../app/research/price-targets-panel.tsx');
  try {
    panel.render(); panel.mount(); await flush();
    env.hide(); env.show(); await flush();
    assert.match(panel.render(), /ASTS/); assert.match(panel.render(), /Displayed items may be stale/);
    panel.unmount(); assert.match(panel.render(), /Fetching price targets/); assert.doesNotMatch(panel.render(), /ASTS/);
  } finally { panel.unmount(); env.restore(); }
});

test('both feeds reuse recent validated memory on remount without skeletons and expire it after two minutes', async () => {
  const env = environment(), timer = clock(); const now = Date.now;
  globalThis.fetch = url => url.endsWith('/stream') ? new Promise(() => {}) : Promise.resolve(Response.json(url.endsWith('/news') ? feed([analyst]) : { ok: true, items: [target] }));
  const news = componentHarness('../app/research/news/general-news-panel.tsx', timer);
  const targets = componentHarness('../app/research/price-targets-panel.tsx');
  try {
    news.render(); news.mount(); await timer.run(); targets.render(); targets.mount(); await flush();
    news.unmount(); targets.unmount();
    assert.match(news.render(), /NVDA/); assert.doesNotMatch(news.render(), /Fetching news/);
    assert.match(targets.render(), /ASTS/); assert.doesNotMatch(targets.render(), /Fetching price targets/);
    news.unmount(); targets.unmount();
    Date.now = () => now() + 120_001;
    assert.match(news.render(), /Fetching news/); assert.doesNotMatch(news.render(), /NVDA/);
    assert.match(targets.render(), /Fetching price targets/); assert.doesNotMatch(targets.render(), /ASTS/);
  } finally { Date.now = now; news.unmount(); targets.unmount(); env.restore(); }
});
