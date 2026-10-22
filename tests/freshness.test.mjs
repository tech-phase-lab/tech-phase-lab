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
  assert.match(notice, /freshness\.status === "ok"\) return null/);
  for (const page of ['news/page.tsx', 'price-targets/page.tsx', 'calendar/event-calendar.tsx', 'general-news/page.tsx', 'market/page.tsx']) {
    assert.match(await readFile(new URL(`../app/research/${page}`, import.meta.url), 'utf8'), /freshness>/, page);
  }
  assert.match(await readFile(new URL('../app/research/research-dashboard.tsx', import.meta.url), 'utf8'), /<FreshnessNotice lang=\{lang\} \/>/);
});
