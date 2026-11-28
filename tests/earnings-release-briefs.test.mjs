import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { priorRelease, withPriorOutlook } from '../lib/research/earnings-guidance.ts';
import { earningsTable, guidanceValue } from '../lib/research/earnings-table.ts';
import { buildXPost, pickConsensus } from '../lib/research/x-post-copy.ts';
import { parseResultBriefs } from '../lib/research/market-results.ts';

// DELL, NVDA and MU read from their real SEC releases by the monitor's parsers (tests/earnings_release_briefs.py; the Python test
// checks this JSON against the parsers): the latest release and the one before it, which the background backfill now stores (Nov 28).
const briefs = JSON.parse(readFileSync(new URL('./fixtures/earnings-release-briefs.json', import.meta.url), 'utf8'));
const pair = ticker => parseResultBriefs([briefs[ticker].latest, briefs[ticker].prior], 2);
const card = ticker => {
  const [latest, prior] = pair(ticker);
  const outlook = withPriorOutlook(latest, priorRelease(latest, [prior]));
  return { latest, outlook, table: earningsTable(outlook.facts, null, null, outlook.revenueGuidance) };
};
const rows = table => [...table.results, ...table.guidance].map(r => `${r.label.ja} ${r.actual.ja}${r.yoy ? ` ${r.yoy.ja}` : ''}${r.note ? ` ${r.note.ja}` : ''}`);

test('DELL Q3 FY27: 会社予想 from the Sep 1 release, the outlook raised from the release\'s own Previous column', () => {
  const { latest, outlook, table } = card('DELL');
  assert.deepEqual(rows(table), ['売上高 549.37億ドル +103% （会社予想 490億ドル）', '営業利益 74.42億ドル +251%', '営業利益率 13.5%', '純利益 56.73億ドル +266%',
    'EPS 8.82ドル +287%', 'EPS（調整後） 9.45ドル +265%', '次四半期売上 563億ドル', '次四半期調整後EPS 8.40ドル', '通期売上 2,020億ドル 従来予想を上方修正',
    '通期調整後EPS 29.68ドル 従来予想を上方修正']);
  assert.equal(buildXPost({ ...latest, facts: outlook.facts }, null, 'consensus'), `【DELL 決算速報】

⭕️通期売上見通し 2,020億ドル（上方修正）
⭕️通期調整後EPS見通し 29.68ドル（上方修正）
✅売上高 549.37億ドル（前年比+103%）
✅EPS 8.82ドル（前年比+287%）
✅EPS（調整後） 9.45ドル（前年比+265%）
✅純利益 56.73億ドル（前年比+266%）
✅営業利益 74.42億ドル（前年比+251%）
✅次四半期売上見通し 563億ドル
✅次四半期調整後EPS見通し 8.40ドル`);
});

test('DELL as production stores it today (full-year outlook under guidance-revenue) still meets the backfilled Sep 1 release', () => {
  const stored = JSON.parse(readFileSync(new URL('./fixtures/dell-result-brief-q3fy27.json', import.meta.url), 'utf8'));
  const [, prior] = pair('DELL');
  const { facts, revenueGuidance } = withPriorOutlook(stored, priorRelease(stored, [prior]));
  assert.equal(revenueGuidance, '$49.0B', 'the Sep 1 release guided Q3 FY27 revenue at $49.0 billion');
  assert.equal(facts.find(f => f.key === 'guidance-revenue').comparisons.priorGuidance, '$192.0B', 'matched by what it forecasts, not by its key');
});

test('NVDA Q3 FY27: 会社予想 is the Aug 26 outlook; the consensus stays on the adjusted EPS it matched', () => {
  const { latest, outlook, table } = card('NVDA');
  assert.equal(outlook.revenueGuidance, '$108.0B ± 2%');
  assert.equal(rows(table)[0], '売上高 1,158億ドル +103% （会社予想 1,080億ドル±2%）');
  assert.equal(rows(table).at(-1), '次四半期売上 1,300億ドル±3%');
  // production's /api/research/earnings-consensus answered 2.47 for NVDA on Nov 28
  assert.equal(buildXPost({ ...latest, facts: outlook.facts }, { estimate: 2.47, date: '2026-11-17' }, 'short', 'adjusted-eps'), `【NVDA 決算速報】

⭕️EPS（調整後） 2.68ドル（市場予想2.47ドル）
✅売上高 1,158億ドル（前年比+103%）
✅EPS 2.70ドル（前年比+108%）
✅純利益 653億ドル（前年比+105%）
✅営業利益 775億ドル（前年比+115%）
✅データセンター売上高 1,076億ドル（前年比+110%）
✅次四半期売上見通し 1,300億ドル±3%

予想の提供: Twelve Data`);
});

test('MU Q4 FY26: the outlook in Micron\'s own form (midpoint ± dollars), 会社予想 from the Jun 24 release', () => {
  const { latest, outlook, table } = card('MU');
  assert.equal(rows(table)[0], '売上高 542.29億ドル +379% （会社予想 500億ドル±10億ドル）');
  assert.deepEqual(rows(table).slice(-2), ['次四半期売上 615億ドル±15億ドル', '次四半期調整後EPS 38.15ドル±1.00ドル']);
  // the table's YoY with a thousands separator, as the X copy writes it
  assert.equal(rows(table)[1], '営業利益 437.51億ドル +1,097%');
  assert.equal(rows(table)[5], 'EPS（調整後） 33.42ドル +1,003%');
  assert.equal(buildXPost({ ...latest, facts: outlook.facts }, null, 'short'), `【MU 決算速報】

✅売上高 542.29億ドル（前年比+379%）
✅EPS 32.87ドル（前年比+1,061%）
✅EPS（調整後） 33.42ドル（前年比+1,003%）
✅純利益 377.01億ドル（前年比+1,078%）
✅営業利益 437.51億ドル（前年比+1,097%）
✅次四半期売上見通し 615億ドル±15億ドル
✅次四半期調整後EPS見通し 38.15ドル±1.00ドル`);
});

test('an outlook naming its quarter is used for that quarter only', () => {
  const fact = (key, ja, en, value) => ({ key, ja, en, value });
  const brief = (period, publishedAt, facts) => ({ ticker: 'CRWD', period, publishedAt, facts, kind: 'earnings', researchId: 'ir-flash-1' });
  const q2 = brief('Q2 FY2027', '2026-08-26T20:07:02Z', [fact('revenue', '売上高', 'Revenue', '$1.47B'),
    fact('guidance-revenue', '会社予想 売上高（Q3 FY27）', 'Guidance revenue (Q3 FY27)', '$1.5232B-$1.5292B'),
    fact('guidance-fy-revenue', '会社予想 通期売上高（FY27）', 'Full-year guidance revenue (FY27)', '$5.9911B-$6.0111B')]);
  const q3 = brief('Q3 FY2027', '2026-11-23T21:05:00Z', [fact('revenue', '売上高', 'Revenue', '$1.583419B'),
    fact('guidance-fy-revenue', '会社予想 通期売上高（FY27）', 'Full-year guidance revenue (FY27)', '$6.0781B-$6.0841B')]);
  const { facts, revenueGuidance } = withPriorOutlook(q3, priorRelease(q3, [q2]));
  assert.equal(revenueGuidance, '$1.5232B-$1.5292B');
  assert.equal(facts[1].comparisons.priorGuidance, '$5.9911B-$6.0111B');
  const other = { ...q2, facts: [q2.facts[0], { ...q2.facts[1], ja: '会社予想 売上高（Q4 FY27）', en: 'Guidance revenue (Q4 FY27)' }] };
  assert.equal(withPriorOutlook(q3, other).revenueGuidance, null, 'an outlook for another quarter is never this quarter\'s 会社予想');
});

test('a dollar band is written as the release writes it; anything unreadable gives nothing', () => {
  assert.deepEqual(guidanceValue('guidance-revenue', '$61.5B ± $1.5B'), { ja: '615億ドル±15億ドル', en: '$61.5B ± $1.5B' });
  assert.deepEqual(guidanceValue('guidance-adjusted-eps', '$38.15 ± $1.00'), { ja: '38.15ドル±1.00ドル', en: '$38.15 ± $1.00' });
  assert.equal(guidanceValue('guidance-revenue', '$61.5B ± about 1'), null);
});

test('the consensus goes to the EPS basis it is closest to when the release states both', () => {
  const raw = { earnings: [{ date: '2026-11-03', eps_estimate: 1.15, eps_actual: 1.2 }] };
  assert.deepEqual(pickConsensus(raw, '2026-11-03T21:10:00Z', 1.2, 1.22), { estimate: 1.15, date: '2026-11-03' });
  assert.equal(pickConsensus(raw, '2026-11-03T21:10:00Z', 1.22, 1.2), null, 'GAAP $1.22 is within 0.02 of the adjusted $1.20, but the adjusted one is it');
  assert.deepEqual(pickConsensus(raw, '2026-11-03T21:10:00Z', 1.21), { estimate: 1.15, date: '2026-11-03' }, 'one basis stored: as before');
  const route = readFileSync(new URL('../app/api/research/earnings-consensus/route.ts', import.meta.url), 'utf8');
  assert.match(route, /loadEpsConsensus\(ticker, at, eps, other\)/);
  const table = readFileSync(new URL('../app/research/calendar/earnings-result-table.tsx', import.meta.url), 'utf8');
  assert.match(table, /\.\.\.\(other \? \{ other \} : \{\}\)/);
});
