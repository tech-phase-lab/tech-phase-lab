import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { earningsTable, headline, moneyJa, postable } from '../lib/research/earnings-table.ts';
import { buildXPost } from '../lib/research/x-post-copy.ts';
import { parseResultBriefs } from '../lib/research/market-results.ts';

// CrowdStrike Q2 FY2027 as the issuer flash stores it (tests/fixtures/crwd-results-q2fy27.txt through issuer_result_flash + release_extras)
const f = (key, ja, en, value, comparisons) => ({ key, ja, en, value, ...(comparisons ? { comparisons } : {}) });
const crwd = [
  f('revenue', '売上高', 'Revenue', '$1.470897B', { yearAgo: '$1.168952B' }),
  f('eps', 'EPS（希薄化後）', 'Diluted EPS', '$0.01', { yearAgo: '$-0.07' }),
  f('net-income', '純損益', 'Net income / (loss)', '$5.306M', { yearAgo: '$-70.153M' }),
  f('operating-income', '営業損益', 'Operating income / (loss)', '$-33.232M', { yearAgo: '$-105.457M' }),
  f('adjusted-eps', '調整後EPS', 'Adjusted EPS', '$0.31', { yearAgo: '$0.23' }),
  f('adjusted-net-income', '調整後純利益', 'Adjusted net income', '$322.9M', { yearAgo: '$237.4M' }),
  f('free-cash-flow', 'フリーキャッシュフロー', 'Free cash flow', '$377.4M', { yearAgo: '$283.6M' }),
  f('operating-cash-flow', '営業キャッシュフロー', 'Operating cash flow', '$530.3M', { yearAgo: '$332.8M' }),
  f('arr', 'ARR', 'ARR', '$5.84B', { growth: '+25%' }),
  f('guidance-revenue', '会社予想 売上高（Q3 FY27）', 'Guidance revenue (Q3 FY27)', '$1.5232B-$1.5292B'),
  f('guidance-fy-revenue', '会社予想 通期売上高（FY27）', 'Full-year guidance revenue (FY27)', '$5.9911B-$6.0111B'),
  f('guidance-adjusted-eps', '会社予想 調整後EPS（Q3 FY27）', 'Guidance adjusted EPS (Q3 FY27)', '$0.31'),
  f('guidance-fy-adjusted-eps', '会社予想 通期調整後EPS（FY27）', 'Full-year guidance adjusted EPS (FY27)', '$1.25-$1.26'),
];

test('one unit rule: 億ドル from 1億, 万ドル below; the sign is in the label (純損失), never 純損益', () => {
  assert.equal(moneyJa(1.470897e9), '14.71億ドル');
  assert.equal(moneyJa(-2.49e7), '2,490万ドル');
  assert.equal(moneyJa(1.158e11), '1,158億ドル');
  const { results } = earningsTable([f('net-income', '純損益', 'Net income / (loss)', '$-24.9M')]);
  assert.deepEqual([results[0].label.ja, results[0].actual.ja, results[0].label.en, results[0].actual.en], ['純損失', '2,490万ドル', 'Net loss', '$24.9M']);
});

test('the CrowdStrike card: every figure with its change, and the company guidance apart', () => {
  const { results, guidance } = earningsTable(crwd);
  const rows = Object.fromEntries(results.map(r => [r.key, [r.label.ja, r.actual.ja, r.yoy?.ja ?? null]]));
  assert.deepEqual(rows.revenue, ['売上高', '14.71億ドル', '+26%']);
  assert.deepEqual(rows['net-income'], ['純利益', '531万ドル', '黒字転換']);
  assert.deepEqual(rows['operating-income'], ['営業損失', '3,323万ドル', '赤字縮小']);
  assert.deepEqual(rows['operating-margin'], ['営業利益率', '−2.3%', null]);
  assert.deepEqual(rows['adjusted-eps'], ['調整後EPS', '0.31ドル', '+35%']);
  assert.deepEqual(rows.arr, ['ARR', '58.4億ドル', '+25%']);
  assert.deepEqual(rows['free-cash-flow'], ['フリーCF', '3.77億ドル', '+33%']);
  assert.deepEqual(guidance.map(r => [r.label.ja, r.actual.ja]), [
    ['売上高（Q3 FY27）', '15.23〜15.29億ドル'], ['調整後EPS（Q3 FY27）', '0.31ドル'],
    ['通期売上高（FY27）', '59.91〜60.11億ドル'], ['通期調整後EPS（FY27）', '1.25〜1.26ドル']]);
  assert.equal(guidance[0].label.en, 'Revenue (Q3 FY27)');
  assert.equal(guidance[2].label.en, 'Full-year revenue (FY27)');
  assert.equal(guidance[0].actual.en, '$1.52B–$1.53B');
});

test('the consensus difference sits on the EPS basis it matched', () => {
  const { results } = earningsTable(crwd, { estimate: 0.29, date: '2026-08-26' }, 'adjusted-eps');
  const row = results.find(r => r.key === 'adjusted-eps');
  assert.equal(row.versus.ja, '上回る（予想0.29ドル・+7%）');
  assert.equal(row.versus.en, 'Beat (est. $0.29, +7%)');
  assert.equal(row.tone, 'up');
  assert.equal(results.find(r => r.key === 'eps').versus, null);
  assert.ok(earningsTable(crwd).results.every(r => r.versus === null), 'no consensus: no difference column');
});

test('collapsed line and X post copy (only with revenue + EPS + guidance)', () => {
  assert.equal(headline(crwd, 'ja'), '売上高 14.71億ドル（+26%）・調整後EPS 0.31ドル（+35%）・純利益 531万ドル（黒字転換）');
  assert.equal(postable(crwd), true);
  assert.equal(postable(crwd.filter(x => !x.key.startsWith('guidance-'))), false);
  assert.equal(postable(crwd.filter(x => x.key !== 'revenue')), false);
  const text = buildXPost({ ticker: 'CRWD', period: 'Q2 FY2027', facts: crwd }, null, 'short');
  assert.match(text, /売上高14\.71億ドル（前年比\+26％）/);
  assert.match(text, /調整後EPS0\.31ドル/);
  assert.match(text, /純利益531万ドル/);
  assert.match(text, /ARR58\.4億ドル（前年比\+25％）/);
  assert.match(text, /会社予想 売上高（Q3 FY27）15\.23〜15\.29億ドル/);
  assert.match(text, /会社予想 調整後EPS（Q3 FY27）0\.31ドル/);
  assert.doesNotMatch(text, /フリーキャッシュフロー|Twelve/);
});

test('the issuer flash may carry up to 16 figures, new keys and a stated growth rate', () => {
  const brief = { id: '1', researchId: 'ir-flash-1', kind: 'earnings', ticker: 'CRWD', period: 'Q2 FY2027', titleJa: 'CRWD Q2 FY2027決算', titleEn: 'CRWD Q2 FY2027 earnings',
    facts: crwd, url: 'https://www.sec.gov/Archives/edgar/data/1535527/000153552726000020/crwd-20260826xex991.htm', publisher: 'CrowdStrike IR (SEC 8-K)',
    publishedAt: '2026-08-26T20:05:00.000+00:00', observedAt: '2026-08-26T20:05:00.000+00:00', publicAt: '2026-08-26T20:05:01.000+00:00', processingMs: 10, sourceToDetectionMs: null, detectionToPublicMs: 1000 };
  const [parsed] = parseResultBriefs([brief]);
  assert.equal(parsed.facts.length, 13);
  assert.deepEqual(parsed.facts.find(x => x.key === 'arr').comparisons, { growth: '+25%' });
  assert.throws(() => parseResultBriefs([{ ...brief, facts: [...crwd, ...crwd] }]));
});

test('the results card has no per-card provider or disclaimer lines; the provider is credited once under the list', () => {
  const reaction = readFileSync(new URL('../app/research/calendar/earnings-reaction.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(reaction, /値動きの理由は断定しません|株価の提供/);
  const panel = readFileSync(new URL('../app/research/calendar/economic-results-panel.tsx', import.meta.url), 'utf8');
  assert.equal(panel.match(/Twelve Data/g).length, 2); // one credit line, both languages
  assert.doesNotMatch(panel, /会社の決算資料から数値を読み取りました/);
});
