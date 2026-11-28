import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guidanceHorizon, priorRelease, quarterOf, withPriorOutlook } from '../lib/research/earnings-guidance.ts';
import { parseResultBriefs } from '../lib/research/market-results.ts';

// DELL Q3 FY2027 as stored in production (tests/fixtures/dell-result-brief-q3fy27.json) and its Q2 FY2027 release
// (tests/fixtures/dell-results-q2fy27.txt through issuer_result_flash.parse_dell): FY27 revenue outlook $192.0B, then $202.0B.
const dell = JSON.parse(readFileSync(new URL('./fixtures/dell-result-brief-q3fy27.json', import.meta.url), 'utf8'));
const fact = (key, ja, en, value, comparisons) => ({ key, ja, en, value, ...(comparisons ? { comparisons } : {}) });
const brief = (ticker, period, publishedAt, facts, researchId = 'ir-flash-2') => ({ id: '2', researchId, kind: 'earnings', ticker, period, publishedAt, titleJa: '', titleEn: '', url: 'https://www.sec.gov/x', publisher: 'SEC', facts,
  observedAt: publishedAt, publicAt: publishedAt, processingMs: 0, sourceToDetectionMs: null, detectionToPublicMs: null });
const dellQ2 = brief('DELL', 'Q2 FY2027', '2026-09-01T20:05:00Z', [fact('revenue', '売上高', 'Revenue', '$46.971B', { yearAgo: '$29.776B' }), fact('guidance-revenue', '通期見通し 売上高', 'Full-year guidance Revenue', '$192.0B')]);

test('periods and horizons are read, never guessed', () => {
  assert.deepEqual([quarterOf('Q3 FY2027'), quarterOf('Q3 FY27'), quarterOf('2026Q3'), quarterOf('FY2026')], [{ quarter: 3, year: 2027 }, { quarter: 3, year: 2027 }, { quarter: 3, year: 2026 }, null]);
  assert.equal(guidanceHorizon(fact('guidance-revenue', '通期見通し 売上高', 'Full-year guidance Revenue', '$1B')), 'year');
  assert.equal(guidanceHorizon(fact('guidance-revenue', '次四半期見通し 売上高', 'Next-quarter guidance Revenue', '$1B')), 'quarter');
  assert.equal(guidanceHorizon(fact('guidance-revenue', '会社見通し 売上高', 'Guidance revenue', '$1B')), null, 'a label that does not say is not compared');
});

test('DELL: the full-year outlook is 上方修正 against the previous release of the same fiscal year; nothing without that release', () => {
  assert.equal(priorRelease(dell, []), null);
  assert.deepEqual(withPriorOutlook(dell, null), { facts: dell.facts, revenueGuidance: null }, 'no stored previous release: nothing is added');
  const prior = priorRelease(dell, [dellQ2, brief('DELL', 'Q2 FY2027', '2026-09-01T20:05:00Z', dellQ2.facts, 'x-result-2')]);
  assert.equal(prior.researchId, 'ir-flash-2', 'only the issuer\'s own table');
  const { facts, revenueGuidance } = withPriorOutlook(dell, prior);
  assert.equal(facts.find(f => f.key === 'guidance-revenue').comparisons.priorGuidance, '$192.0B');
  assert.equal(revenueGuidance, null, 'DELL\'s previous release stored no next-quarter revenue outlook');
  const q1 = { ...dell, period: 'Q1 FY2028' };
  assert.equal(priorRelease(q1, [dellQ2]), null, 'Q1 follows Q4, not Q2');
});

test('the company forecast under revenue is the previous release\'s next-quarter outlook', () => {
  const nvdaQ2 = brief('NVDA', 'Q2 FY2027', '2026-08-26T20:20:00Z', [fact('guidance-revenue', '次四半期見通し 売上高', 'Next-quarter guidance Revenue', '$110.0B ± 2%')]);
  const nvdaQ3 = brief('NVDA', 'Q3 FY2027', '2026-11-17T21:22:03Z', [fact('revenue', '売上高', 'Revenue', '$115.8B'), fact('guidance-revenue', '次四半期見通し 売上高', 'Next-quarter guidance Revenue', '$130.0B ± 3%')]);
  const { facts, revenueGuidance } = withPriorOutlook(nvdaQ3, priorRelease(nvdaQ3, [nvdaQ2]));
  assert.equal(revenueGuidance, '$110.0B ± 2%');
  assert.equal(facts.find(f => f.key === 'guidance-revenue').comparisons, undefined, 'a next-quarter outlook is for another quarter: never 修正');
});

test('a stated previous outlook passes the issuer-flash check; anything else is dropped', () => {
  const raw = { ...dell, facts: [...dell.facts.slice(0, 4), { ...dell.facts[4], comparisons: { priorGuidance: '$192.0B' } }, { key: 'guidance-fy-revenue', ja: 'x', en: 'x', value: '$5B', comparisons: { priorGuidance: '上方修正' } }] };
  const [parsed] = parseResultBriefs([raw]);
  assert.deepEqual(parsed.facts[4].comparisons, { priorGuidance: '$192.0B' });
  assert.equal(parsed.facts[5].comparisons, undefined);
});

test('the card hides its summary line when opened and asks the stored months before for the previous release', () => {
  const panel = readFileSync(new URL('../app/research/calendar/economic-results-panel.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/research/calendar/event-calendar.module.css', import.meta.url), 'utf8');
  assert.match(panel, /<details className=\{calendarStyles\.earningsRow\}>/);
  assert.match(css, /\.earningsRow\[open\]>summary \.eventName small\{display:none\}/);
  const table = readFileSync(new URL('../app/research/calendar/earnings-result-table.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(table, /市場予想との差|vs\. consensus|"会社予想" : "Company guidance"/);
  assert.match(table, /"次の見通し" : "Outlook"/);
  const hook = readFileSync(new URL('../app/research/calendar/use-prior-release.ts', import.meta.url), 'utf8');
  assert.match(hook, /\/api\/research\/earnings-results\?month=/, 'the FREE stored results, no paid call');
});
