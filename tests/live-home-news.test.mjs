import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { buildPublicNews } from '../lib/research/public-news-response.ts';
let source = (await readFile(new URL('../lib/research/live-result-events.ts', import.meta.url), 'utf8')).replace("import 'server-only';", '');
for (const name of ['public-news-response', 'general-news', 'market-results', 'official-result-events']) {
  source = source.replaceAll(`'./${name}'`, JSON.stringify(new URL(`../lib/research/${name}.ts`, import.meta.url).href));
}
const { loadLiveHomeNews } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
test('home reuses one monitor response for sanitized initial news and events, and exposes failure for retry', async () => {
  const original = { fetch: globalThis.fetch, url: process.env.RESEARCH_MONITOR_URL, token: process.env.RESEARCH_MONITOR_TOKEN };
  const payload = { ok: true, enabled: true, items: [], officialUpdates: [], resultBriefs: [], privateToken: 'must-not-be-serialized' };
  let requests = 0;
  process.env.RESEARCH_MONITOR_URL = 'https://monitor.example.com';
  process.env.RESEARCH_MONITOR_TOKEN = 'synthetic-test-token';
  try {
    globalThis.fetch = async () => { requests++; return Response.json(payload); };
    const result = await loadLiveHomeNews();
    assert.equal(requests, 1);
    assert.deepEqual(result.news.data, buildPublicNews(payload));
    assert.deepEqual(result.events, []);
    assert.ok(result.news.checkedAt <= Date.now());
    assert.ok(!JSON.stringify(result).includes(payload.privateToken));
    globalThis.fetch = async () => new Response('', { status: 503 });
    assert.deepEqual(await loadLiveHomeNews(), { events: [], news: null });
  } finally {
    globalThis.fetch = original.fetch;
    for (const [key, value] of [['RESEARCH_MONITOR_URL', original.url], ['RESEARCH_MONITOR_TOKEN', original.token]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('initial news cannot replace a fresher refresh or reappear after a failed check', async () => {
  const panel = await readFile(new URL('../app/research/news/general-news-panel.tsx', import.meta.url), 'utf8');
  const helpers = panel.slice(panel.indexOf('let snapshot:'), panel.indexOf('export default function'));
  const stateHelpers = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(helpers + '\nexport { initialSnapshot }; export function seed(cache, failedAt) { snapshot = cache; lastFailedAt = failedAt; }')).toString('base64'));
  const now = Date.now();
  const initial = { data: { items: ['initial'] }, checkedAt: now - 1000 };
  assert.deepEqual(stateHelpers.initialSnapshot(initial).data, initial.data);
  const fresh = { data: { items: ['fresh'] }, time: now, at: new Date(now).toISOString() };
  stateHelpers.seed(fresh, 0);
  assert.deepEqual(stateHelpers.initialSnapshot(initial), fresh);
  stateHelpers.seed(null, now);
  assert.equal(stateHelpers.initialSnapshot(initial), null);
  stateHelpers.seed(null, 0);
  assert.equal(stateHelpers.initialSnapshot({ ...initial, checkedAt: now - 120001 }), null);
});
