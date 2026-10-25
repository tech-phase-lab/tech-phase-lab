import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { projectTechNews, FREE_TECH_DELAY_MS } from '../lib/research/tech-news-access.ts';
import { buildPublicNews } from '../lib/research/public-news-response.ts';
import { availableNewsPayload } from '../lib/research/general-news.ts';
import { flashRows } from '../lib/research/flash-rows.ts';
import { newsPulseItems } from '../lib/research/news-pulse-items.ts';

const now = Date.parse('2026-10-25T12:00:00Z');
const at = minutes => new Date(now - minutes * 60000).toISOString();
const official = (id, minutes = 40, extra = {}) => ({ id: String(id), title: `Nebius expands capacity ${id}`, translationJa: `ネビウスが容量を拡大 ${id}`,
  url: `https://x.com/nebiusai/status/${id}`, publisher: 'Nebius', tickers: ['NBIS'], observedAt: at(minutes), publishedAt: at(minutes), bodyJa: '有料本文', bodyEn: 'PAID_BODY_SENTINEL', ...extra });
const raw = updates => ({ ok: true, enabled: true, items: [], officialUpdates: updates });
const wire = { NVDA: [{ id: 'wire1', titleEn: 'NVIDIA adds capacity', titleJa: 'エヌビディアが容量を拡大', publisher: 'Example', origin: 'wire', url: 'https://example.com/story', publishedAt: at(35) }] };

test('FREE boundary is exactly 30 minutes, newest five across sources, no paid bytes in parsers or rows', () => {
  const feed = buildPublicNews(raw([official(1, 29.999), official(2, 30), ...[31, 32, 33, 34, 36, 37].map((m, i) => official(i + 3, m))]));
  const free = projectTechNews(feed, wire, false, now);
  assert.equal(free.techHeadlines.length, 5);
  assert.deepEqual(free.techHeadlines.map(x => x.id), ['official:2', 'official:3', 'official:4', 'official:5', 'official:6']);
  assert.doesNotMatch(JSON.stringify(free), /PAID_BODY_SENTINEL|有料本文|Nebius expands capacity 1"/);
  assert.equal(free.officialUpdates.some(x => x.id === '2'), false);
  const parsed = availableNewsPayload(free);
  assert.deepEqual(parsed.techHeadlines, free.techHeadlines);
  for (const lang of ['ja', 'en']) {
    const rows = flashRows(parsed, {}, lang).filter(row => row.kind === 'news');
    assert.equal(rows.length, 5);
    assert.ok(rows.every(row => row.body === undefined));
    assert.ok(newsPulseItems(parsed, lang, now).every(row => !row.body.includes('PAID_BODY_SENTINEL')));
  }
  const merged = projectTechNews(buildPublicNews(raw([official(9, 40)])), wire, false, now);
  assert.deepEqual(merged.techHeadlines.map(x => x.id), ['wire:wire1', 'official:9']);
});

test('one source shared by official and wire lanes consumes only one FREE slot', () => {
  const item = official(5, 40);
  const repeated = { NBIS: [{ ...wire.NVDA[0], id: 'same-source', url: item.url, publishedAt: item.publishedAt }] };
  const free = projectTechNews(buildPublicNews(raw([item])), repeated, false, now);
  assert.equal(free.techHeadlines.length, 1);
});

test('future/unknown dates are held; date-only entries wait from observation and do not invent a release clock', () => {
  const dated = official(2, 5, { publishedAt: undefined, publishedOn: '2026-10-24' });
  const feed = buildPublicNews(raw([official(1, -1), dated]));
  assert.equal(projectTechNews(feed, {}, false, now).techHeadlines.length, 0);
  const later = projectTechNews(feed, {}, false, now + FREE_TECH_DELAY_MS);
  assert.equal(later.techHeadlines[0].timeKind, 'date');
  assert.equal(later.techHeadlines[0].at, '2026-10-24');
});

test('PRO retains summaries; FREE preserves general news, results and market figures', () => {
  const general = official(3, 1, { tickers: [], title: 'Economic update', translationJa: '経済ニュース', bodyEn: 'FREE_GENERAL_BODY' });
  const feed = buildPublicNews(raw([official(1, 1), general]));
  const pro = projectTechNews(feed, {}, true, now);
  assert.deepEqual(pro.officialUpdates, feed.officialUpdates);
  assert.match(JSON.stringify(pro), /PAID_BODY_SENTINEL/);
  const free = projectTechNews(feed, {}, false, now);
  assert.match(JSON.stringify(free), /FREE_GENERAL_BODY/);
  assert.ok(free.officialUpdates.some(x => x.researchId === 'mu-q4-2026'));
  assert.deepEqual(free.resultBriefs, feed.resultBriefs);
  const withUnknown = projectTechNews({ ...feed, originalPreviewItems: [{ summary: { bodyEn: 'SECRET_PREVIEW' } }], privateExtra: 'SECRET_EXTRA' }, {}, false, now);
  assert.doesNotMatch(JSON.stringify(withUnknown), /SECRET_/);
});

test('a FREE response immediately suppresses a previously loaded PRO wire snapshot', () => {
  const free = projectTechNews(buildPublicNews(raw([])), {}, false, now);
  assert.equal(flashRows(free, wire, 'en').filter(row => row.kind === 'news').length, 0);
  assert.equal(newsPulseItems(free, 'en', now, wire).some(row => row.id.startsWith('wire-')), false);
});

test('generic item summary is never used as a FREE headline', () => {
  const feed = { ok: true, enabled: true, items: [{ id: 'a', tickers: ['MU'], title: 'Original headline', summaryJa: 'SECRET_SUMMARY', summaryEn: 'SECRET_SUMMARY', impactJa: 'SECRET_IMPACT', impactEn: 'SECRET_IMPACT', publishedAt: at(40) }] };
  const free = projectTechNews(feed, {}, false, now);
  assert.equal(free.techHeadlines[0].titleEn, 'Original headline');
  assert.equal(free.techHeadlines[0].titleJa, undefined);
  assert.doesNotMatch(JSON.stringify(free), /SECRET_/);
});

const path = name => JSON.stringify(new URL(`../lib/research/${name}.ts`, import.meta.url).href);
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64');
let serverSource = readFileSync(new URL('../lib/research/news-audience-server.ts', import.meta.url), 'utf8')
  .replace("import 'server-only';", '')
  .replace("import { getMembership } from '@/lib/membership/server';", 'const getMembership = async () => { if (globalThis.__techAccess.error) throw Error("offline"); return {plan: globalThis.__techAccess.plan}; };');
for (const name of ['company-wire', 'tech-news-access', 'general-news']) serverSource = serverSource.replaceAll(`'./${name}'`, path(name));
const serverUrl = moduleUrl(serverSource);
const routeSource = readFileSync(new URL('../app/api/research/news/route.ts', import.meta.url), 'utf8')
  .replace('"@/lib/research/news-audience-server"', JSON.stringify(serverUrl)).replace('"@/lib/research/public-news-response"', path('public-news-response'));
const wireSource = readFileSync(new URL('../app/api/research/company-wire/route.ts', import.meta.url), 'utf8')
  .replace('"@/lib/research/news-audience-server"', JSON.stringify(serverUrl)).replace('"@/lib/research/company-wire"', path('company-wire'));
let homeSource = readFileSync(new URL('../lib/research/live-result-events.ts', import.meta.url), 'utf8').replace("import 'server-only';", '')
  .replace('"./news-audience-server"', JSON.stringify(serverUrl));
for (const name of ['public-news-response', 'general-news', 'market-results', 'official-result-events']) homeSource = homeSource.replaceAll(`'./${name}'`, path(name));
const { GET } = await import(moduleUrl(routeSource));
const { GET: getWire } = await import(moduleUrl(wireSource));
const { loadLiveHomeNews } = await import(moduleUrl(homeSource));

test('real API + SSR boundaries use server membership, reject plan query bypass and fail closed on auth errors', async () => {
  const oldFetch = globalThis.fetch, oldState = globalThis.__techAccess;
  const oldEnv = { RESEARCH_MONITOR_URL: process.env.RESEARCH_MONITOR_URL, RESEARCH_MONITOR_TOKEN: process.env.RESEARCH_MONITOR_TOKEN };
  process.env.RESEARCH_MONITOR_URL = 'https://monitor.example'; process.env.RESEARCH_MONITOR_TOKEN = 'test-secret';
  try {
    globalThis.fetch = async url => Response.json(String(url).endsWith('/company-wire') ? { ok: true, items: wire } : raw([official(1, 40)]));
    for (const state of [{ plan: 'free' }, { plan: 'pro' }, { plan: 'pro', error: true }]) {
      globalThis.__techAccess = state;
      const pro = state.plan === 'pro' && !state.error;
      const response = await GET(new Request('https://site.example/api/research/news?plan=pro'));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal(response.headers.get('vary'), 'Cookie');
      const data = await response.json();
      assert.equal(data.techAccess, pro ? 'pro' : 'free');
      assert.equal(JSON.stringify(data).includes('PAID_BODY_SENTINEL'), pro);
      const home = await loadLiveHomeNews();
      assert.equal(home.news.data.techAccess, data.techAccess);
      assert.equal(JSON.stringify(home).includes('PAID_BODY_SENTINEL'), pro);
      const wired = await (await getWire()).json();
      assert.equal(Object.keys(wired.items).length > 0, pro);
    }
  } finally {
    globalThis.fetch = oldFetch;
    if (oldState === undefined) delete globalThis.__techAccess; else globalThis.__techAccess = oldState;
    for (const [key, value] of Object.entries(oldEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
