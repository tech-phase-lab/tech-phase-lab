import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { assessFreshness } from '../lib/research/freshness.ts';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const live = (monitor, extra = {}) => ({ ok: true, mode: 'automatic', monitor, ...extra });

test('a monitor that cycled recently is up to date', () => {
  const result = assessFreshness(live({ lastCycleAt: '2026-10-22T11:58:00Z', lastCycleAgeSeconds: 120, health: { status: 'ready', issues: [], monitorStaleAfterSeconds: 900 } }), NOW);
  assert.deepEqual(result, { status: 'ok', lastCycleAt: '2026-10-22T11:58:00Z' });
});

test('a stale cycle, or the monitor saying it is stale, is a delay with the last update time', () => {
  const old = assessFreshness(live({ lastCycleAt: '2026-10-22T09:00:00Z', lastCycleAgeSeconds: 10800, health: { status: 'degraded', issues: [], monitorStaleAfterSeconds: 900 } }), NOW);
  assert.deepEqual(old, { status: 'delayed', lastCycleAt: '2026-10-22T09:00:00Z' });
  const flagged = assessFreshness(live({ lastCycleAt: '2026-10-22T11:59:00Z', lastCycleAgeSeconds: 60, health: { status: 'degraded', issues: ['discovery-poll-stale'], monitorStaleAfterSeconds: 900 } }), NOW);
  assert.equal(flagged.status, 'delayed');
  const bodies = assessFreshness(live({ lastCycleAt: '2026-10-22T11:59:00Z', lastCycleAgeSeconds: 60, health: { status: 'degraded', issues: ['body-fetch-stale'], monitorStaleAfterSeconds: 900 } }), NOW);
  assert.equal(bodies.status, 'delayed');
  const unrelated = assessFreshness(live({ lastCycleAt: '2026-10-22T11:59:00Z', lastCycleAgeSeconds: 60, health: { status: 'degraded', issues: ['backup-failed'], monitorStaleAfterSeconds: 900 } }), NOW);
  assert.equal(unrelated.status, 'ok');
});

test('no usable live state is reported as unreachable, and the age falls back to the cycle time', () => {
  for (const payload of [null, undefined, 'x', { ok: false }, { ok: true, mode: 'snapshot' }, { ok: true, mode: 'automatic' }]) assert.equal(assessFreshness(payload, NOW).status, 'unreachable');
  assert.equal(assessFreshness(live({ lastCycleAt: '2026-10-22T08:00:00Z' }), NOW).status, 'delayed');
  assert.equal(assessFreshness(live({ lastCycleAt: 'not a date' }), NOW).status, 'delayed');
});

test('the notice is small, quiet when up to date, and on the pages that show monitored information', async () => {
  const route = await readFile(new URL('../app/api/research/freshness/route.ts', import.meta.url), 'utf8');
  assert.match(route, /status: "unreachable"/);
  assert.doesNotMatch(route, /snapshot/);
  const notice = await readFile(new URL('../app/research/freshness-notice.tsx', import.meta.url), 'utf8');
  assert.match(notice, /freshness\.status === "ok" \|\| bad < 2\) return null/);
  for (const page of ['news/page.tsx', 'price-targets/page.tsx', 'calendar/event-calendar.tsx', 'general-news/page.tsx', 'market/page.tsx']) {
    assert.match(await readFile(new URL(`../app/research/${page}`, import.meta.url), 'utf8'), /freshness>/, page);
  }
  assert.match(await readFile(new URL('../app/research/research-dashboard.tsx', import.meta.url), 'utf8'), /<FreshnessNotice lang=\{lang\} \/>/);
});

test('answers that arrive together after returning to the app count once, and a good answer starts over', async () => {
  const { countBadAnswer } = await import('../lib/research/freshness.ts');
  let state = { bad: 0, at: 0 };
  // visibilitychange, pageshow, focus and online can fire together: four bad answers inside one second are one observation.
  for (let i = 0; i < 4; i++) state = countBadAnswer(state, 'delayed', 1_000_000 + i * 200);
  assert.equal(state.bad, 1);
  state = countBadAnswer(state, 'unreachable', 1_000_000 + 30_000);
  assert.equal(state.bad, 2); // a second answer a poll later does count
  state = countBadAnswer(state, 'ok', 1_000_000 + 60_000);
  assert.deepEqual(state, { bad: 0, at: 0 });
  const source = await readFile(new URL('../app/research/freshness-notice.tsx', import.meta.url), 'utf8');
  assert.match(source, /running \?\?= /); // one check at a time
  assert.match(source, /counter\.current = \{ bad: 0, at: 0 \}/); // clean slate on return
});

test('the freshness answer shares one monitor read, answers from the kept state after 4 s while the read goes on, and ages it (speed, Nov 26)', async t => {
  const { build } = await import('esbuild');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const dir = await mkdtemp(join(tmpdir(), 'freshness-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = join(dir, 'route.mjs');
  await build({ entryPoints: [new URL('../app/api/research/freshness/route.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
    alias: { '@': new URL('..', import.meta.url).pathname.replace(/\/$/, '') },
    plugins: [{ name: 'after', setup(b) { b.onResolve({ filter: /^next\/server$/ }, () => ({ path: 'after', namespace: 's' })); b.onLoad({ filter: /.*/, namespace: 's' }, () => ({ loader: 'js', contents: 'export const after = fn => { globalThis.__after.push(fn()); };' })); } }] });
  globalThis.__after = [];
  process.env.RESEARCH_MONITOR_URL = 'https://monitor.example';
  const live = age => ({ ok: true, mode: 'automatic', monitor: { lastCycleAgeSeconds: age, health: { monitorStaleAfterSeconds: 900, issues: [] } } });
  let calls = 0, release = null;
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; delete process.env.RESEARCH_MONITOR_URL; });
  globalThis.fetch = async (_url, init) => { calls++; if (release === 'fail') throw new Error('down');
    if (release) await new Promise(resolve => { release = resolve; });
    assert.ok(init.signal, 'the read has a time limit'); return new Response(JSON.stringify(live(calls === 1 ? 10 : 20))); };
  const { GET } = await import(pathToFileURL(out).href);
  // No state yet, monitor down: "unreachable", never cached.
  release = 'fail';
  let answer = await GET();
  assert.equal((await answer.json()).status, 'unreachable');
  assert.equal(answer.headers.get('cache-control'), 'no-store'); assert.equal(answer.headers.get('vercel-cdn-cache-control'), null);
  release = null; calls = 0;
  answer = await GET();
  assert.equal((await answer.json()).status, 'ok');
  assert.match(answer.headers.get('vercel-cdn-cache-control'), /s-maxage=30/);
  // 20 s later the read is slow: answered after 4 s from the kept state, not cached; the read goes on and updates the state.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() + 20_000 });
  release = true;
  const pending = GET();
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(4_000);
  answer = await pending;
  assert.equal(answer.headers.get('cache-control'), 'no-store');
  assert.equal(globalThis.__after.length, 1, 'the read continues after the answer');
  release(); await globalThis.__after[0];
  t.mock.timers.tick(1_000);
  const next = await GET();
  assert.equal(calls, 2, 'the continued read is reused, not read again');
  assert.match(next.headers.get('vercel-cdn-cache-control'), /s-maxage=30/);
  const route = await readFile(new URL('../app/api/research/freshness/route.ts', import.meta.url), 'utf8');
  assert.match(route, /READ_TIMEOUT_MS = 13_000, ANSWER_WAIT_MS = 4_000/);
  assert.match(route, /lastCycleAgeSeconds: monitor\.lastCycleAgeSeconds \+ Math\.max\(0, now - at\) \/ 1000/);
  const { assessFreshness } = await import('../lib/research/freshness.ts');
  assert.equal(assessFreshness(live(600)).status, 'ok');
  // The same state kept six minutes later is past the 900-second limit.
  assert.equal(assessFreshness(live(600 + 360)).status, 'delayed');
});
