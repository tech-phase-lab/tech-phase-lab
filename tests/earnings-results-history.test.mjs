import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkedBriefs, historyRange, mergeHistory, resultMonths, resultPeriodKey } from '../lib/research/earnings-results-history.ts';
import { earningsResults, orderedFacts } from '../lib/research/earnings-results.ts';

const history = JSON.parse(readFileSync(new URL('../lib/research/earnings-results-history.json', import.meta.url)));
const coverage = JSON.parse(readFileSync(new URL('../lib/research/calendar-coverage.json', import.meta.url)));
const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('a month is a bounded range; anything else is refused', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  assert.deepEqual(historyRange('2026-10', now), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(historyRange('2026-11', now), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(historyRange('recent', now), { from: '2026-09-01', to: '2026-11-30' });
  for (const bad of ['', '2026-13', '2026-1', '2026-12', '1999-10', '2026-10-01', 'all', '2026-10;x']) assert.equal(historyRange(bad, now), null, bad);
});

test('the committed backfill: every tracked company, every row valid for the site, October and November both filled', () => {
  assert.deepEqual(history.companies.map(c => c.ticker), coverage.map(c => c.ticker));
  const briefs = checkedBriefs(history.resultBriefs);
  assert.equal(briefs.length, history.resultBriefs.length, 'no backfill row is rejected by the site rules');
  const october = mergeHistory({ from: '2026-10-01', to: '2026-10-31' }, briefs);
  const november = mergeHistory({ from: '2026-11-01', to: '2026-11-30' }, briefs);
  assert.ok(october.length >= 15, `October: ${october.length}`);
  assert.ok(november.length >= 15, `November: ${november.length}`);
  assert.deepEqual(resultMonths(briefs), ['2026-10', '2026-11']);
  // October shows on the calendar although the live feed has nothing older than seven days
  const rows = earningsResults([], october);
  assert.ok(rows.some(row => row.ticker === 'META' && row.facts.length >= 3));
  assert.ok(rows.every(row => row.factsFrom !== 'post'));
});

test('one malformed stored row never hides the others; duplicates are merged', () => {
  const [one] = checkedBriefs(history.resultBriefs);
  const rows = checkedBriefs([{ ...one, url: 'https://evil.example/x' }, one, null, 'x']);
  assert.equal(rows.length, 1);
  assert.equal(mergeHistory({ from: '2026-10-01', to: '2026-11-30' }, rows, rows).length, 1);
  assert.deepEqual(checkedBriefs({ resultBriefs: [] }), []);
});

// The monitor's copy of a backfill row: another id and address, detected a minute or two later, with its detection timing.
const monitorCopy = (brief, minutes = 2, changes = {}) => ({ ...brief, id: `9${brief.id}`.slice(0, 24), researchId: `ir-flash-9${brief.id}`.slice(0, 40),
  url: `${brief.url}#monitor`, publishedAt: new Date(Date.parse(brief.publishedAt) + minutes * 60_000).toISOString(), detectionToPublicMs: 3_985_530, ...changes });
const resultKey = brief => `${brief.ticker}|${resultPeriodKey(brief.period)}`;

test('one row per company and quarter: the monitor copy and the SEC backfill are not listed twice (Nov 19)', () => {
  const backfill = checkedBriefs(history.resultBriefs);
  const panw = backfill.find(brief => brief.ticker === 'PANW');
  const range = { from: '2026-10-31', to: '2026-12-01' };
  // same figures: the monitor's row stays
  let rows = mergeHistory(range, [monitorCopy(panw)], backfill).filter(brief => brief.ticker === 'PANW');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detectionToPublicMs, 3_985_530);
  // fewer figures in the monitor's row (NBIS, Nov 12): the backfill's row is kept whole, nothing is mixed in
  const nbis = backfill.find(brief => brief.ticker === 'NBIS');
  const fewer = monitorCopy(nbis, -130, { facts: nbis.facts.slice(0, 2) });
  assert.deepEqual(mergeHistory(range, [fewer], backfill).filter(brief => brief.ticker === 'NBIS'), [nbis]);
  // more figures in the monitor's row: the monitor's row, as it is
  const more = monitorCopy(nbis, -130, { facts: [...nbis.facts, { key: 'gross-margin', ja: '粗利益率', en: 'Gross margin', value: '70%' }] });
  assert.deepEqual(mergeHistory(range, [more], backfill).filter(brief => brief.ticker === 'NBIS'), [more]);
  // the quarter written another way, or an "announced" line without figures: still one row
  assert.equal(mergeHistory(range, [monitorCopy(panw, 1, { period: 'q1 fy27' })], backfill).filter(brief => brief.ticker === 'PANW').length, 1);
  const announced = monitorCopy(panw, -1, { researchId: `ir-announce-9${panw.id}`, facts: [], period: 'Latest' });
  assert.deepEqual(mergeHistory(range, [announced], backfill).filter(brief => brief.ticker === 'PANW'), [panw]);
  // another quarter of the same company stays its own row
  const older = monitorCopy(panw, -92 * 24 * 60, { period: 'Q4 FY2026' });
  assert.equal(mergeHistory({ from: '2026-08-01', to: '2026-12-01' }, [older], backfill).filter(brief => brief.ticker === 'PANW').length, 2);
  assert.equal(resultPeriodKey('Q2 FYE27'), 'Q2FY2027');
});

test('no month lists a company and quarter twice, with the monitor holding a copy of every result', () => {
  const backfill = checkedBriefs(history.resultBriefs);
  const monitor = backfill.map((brief, index) => monitorCopy(brief, index % 2 ? 2 : -2, index % 3 ? {} : { facts: brief.facts.slice(0, 1) }));
  const now = Date.parse('2026-11-19T12:00:00Z');
  for (const month of [...resultMonths(backfill), 'recent']) {
    const range = historyRange(month, now);
    const rows = mergeHistory(range, monitor, backfill);
    const keys = rows.filter(brief => brief.researchId.startsWith('ir-')).map(resultKey);
    assert.equal(new Set(keys).size, keys.length, `${month}: ${keys.filter((key, i) => keys.indexOf(key) !== i)}`);
    assert.ok(rows.length >= 15, month);
  }
  assert.equal(new Set(backfill.map(resultKey)).size, backfill.length, 'the backfill itself has one row per result');
  assert.match(source('app/research/calendar/economic-results-panel.tsx'), /oneResultPerQuarter\(live, /);
});

test('every company lists its figures in one order: revenue, EPS, adjusted EPS, net income, operating income, then outlook', () => {
  const keys = orderedFacts(['guidance-revenue', 'operating-income', 'gross-margin', 'net-income', 'adjusted-eps', 'eps', 'revenue'].map(key => ({ key }))).map(fact => fact.key);
  assert.deepEqual(keys, ['revenue', 'eps', 'adjusted-eps', 'net-income', 'operating-income', 'gross-margin', 'guidance-revenue']);
});

test('the row note says where the figures were read', () => {
  const [issuer] = checkedBriefs(history.resultBriefs).filter(brief => brief.facts.length);
  assert.equal(earningsResults([], [issuer])[0].factsFrom, 'issuer');
  const post = { ...issuer, id: '5', researchId: 'x-result-5', url: 'https://x.com/wallstengine/status/5', publisher: 'Wall St Engine' };
  assert.equal(earningsResults([], [post])[0].factsFrom, 'post');
  const panel = source('app/research/calendar/economic-results-panel.tsx');
  assert.match(panel, /row\.factsFrom === "post" && <p>\{ja \? "決算速報の投稿から数値を読み取りました。/);
  assert.match(panel, /row\.factsFrom === "issuer" && <p>\{ja \? "会社の決算資料から数値を読み取りました。"/);
});

test('the calendar reads stored results by month and lists their months', () => {
  const panel = source('app/research/calendar/economic-results-panel.tsx');
  assert.match(panel, /\/api\/research\/earnings-results\?month=/);
  assert.match(source('app/research/calendar/event-calendar.tsx'), /historyMonths/);
  const route = source('app/api/research/earnings-results/route.ts');
  assert.match(route, /readMonitor\("earnings-results"/);
  assert.match(route, /backfillBriefs\(\)/);
});

test('the X post copy is shown to the owner accounts only (server-decided ownerAccount)', () => {
  const panel = source('app/research/calendar/economic-results-panel.tsx');
  assert.match(panel, /const ownerAccount = useOwnerAccount\(\);/);
  assert.match(panel, /\{ownerAccount && <XPostCopyButton /);
  assert.equal(panel.match(/<XPostCopyButton /g).length, 1);
  assert.match(source('lib/membership/server.ts'), /ownerAccount: isOwnerAccount\(userId\)/);
  assert.match(source('lib/membership/entitlements.ts'), /return userId === OWNER_ACCOUNT_ID \|\| userId === PRODUCTION_OWNER_ACCOUNT_ID;/);
});
