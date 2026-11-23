import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { japaneseMoney, withJapaneseMoney, yenStyle } from '../lib/research/money-ja.ts';
import { parseDeepAnalyses } from '../lib/research/deep-analysis.ts';

// Owner, Nov 18: Japanese copy shows dollar amounts in Japanese units only; a part whose amount lost its scale is not shown.
test('scaled dollar amounts become Japanese units, exactly', () => {
  assert.equal(japaneseMoney('売上高は$115.8 billion。'), '売上高は1,158億ドル。');
  assert.equal(japaneseMoney('次の四半期は$130.0 billion（プラスマイナス3%）。'), '次の四半期は1,300億ドル（±3%）。');
  assert.equal(japaneseMoney('純利益は482 millionドル。'), '純利益は4.82億ドル。');
  assert.equal(japaneseMoney('費用は$12.5 million。'), '費用は1,250万ドル。');
  assert.equal(japaneseMoney('$49–51 billionを見込む。'), '490億〜510億ドルを見込む。');
  assert.equal(japaneseMoney('受注残は$1.5 trillion。'), '受注残は1.5兆ドル。');
  assert.equal(japaneseMoney('希薄化後1株利益は$2.70。'), '希薄化後1株利益は2.70ドル。');
  assert.equal(yenStyle('0.05', 9), '5,000万ドル');
  assert.equal(yenStyle('3.41', 9), '34.1億ドル');
});

test('an amount without its scale, or English units left in Japanese, hides that part', () => {
  assert.equal(withJapaneseMoney({ ja: '売上高は$115.8で、前年同期比103%増。', en: 'Revenue was $115.8, up 103%.' }), null);
  assert.equal(withJapaneseMoney({ ja: '売上高は1,158億ドル。', en: 'Revenue was $115.8.' }), null);
  assert.equal(withJapaneseMoney({ ja: '売上は115.8 billionの規模。', en: 'Revenue was $115.8 billion.' }), null);
  assert.deepEqual(withJapaneseMoney({ ja: '売上高は$115.8 billion。', en: 'Revenue was $115.8 billion.' }),
    { ja: '売上高は1,158億ドル。', en: 'Revenue was $115.8 billion.' });
  assert.deepEqual(withJapaneseMoney({ ja: 'EPSは$2.70。', en: 'EPS was $2.70.' }), { ja: 'EPSは2.70ドル。', en: 'EPS was $2.70.' });
});

test('stored analyses are shown with the same rule: no Japanese text carries billion or million', () => {
  const item = { id: '0123456789abcdef', kind: 'earnings', subject: 'NVDA', sourceUrl: 'https://nvidianews.nvidia.com/news/q3',
    sourceTitle: 'NVIDIA Announces Financial Results', publishedAt: '2026-11-19T21:30:00+00:00',
    headline: { ja: '売上高$115.8 billionの後も伸びるか。', en: 'Can growth continue after $115.8 billion?' },
    summary: { ja: '売上高は$115.8で増えた。', en: 'Revenue was $115.8.' },
    sections: [{ heading: { ja: '見通し', en: 'Guidance' }, ja: '売上高は$130.0 billion（プラスマイナス3%）を見込む。', en: 'Revenue is expected to be $130.0 billion, plus or minus 3%.' },
      { heading: null, ja: '純利益は$65.3で増えた。', en: 'Net income was $65.3.' }],
    scenarios: [], unknowns: [], next: [{ ja: '$130.0 billionと比べたい。', en: 'Compare with $130.0 billion.' }],
    points: [{ ja: '売上は482 million ドル。', en: 'Sales were $482 million.' }], watch: null };
  const [parsed] = parseDeepAnalyses({ items: [item] });
  assert.equal(parsed.headline.ja, '売上高1,158億ドルの後も伸びるか。');
  assert.equal(parsed.summary, null);                       // the bare $115.8 lost its unit
  assert.deepEqual(parsed.sections.map(s => s.ja), ['売上高は1,300億ドル（±3%）を見込む。']);
  assert.equal(parsed.sections[0].en, item.sections[0].en);  // English keeps $130.0 billion
  const japanese = [parsed.headline, ...parsed.sections, ...parsed.next, ...parsed.points].map(part => part.ja).join('\n');
  assert.doesNotMatch(japanese, /billion|million|trillion|\$/i);
});

test('the calendar shows the same Japanese units', () => {
  const panel = readFileSync(new URL('../app/research/calendar/economic-results-panel.tsx', import.meta.url), 'utf8');
  // the figures are a table now (earnings-table.ts: 億ドル from 1億, 万ドル below)
  assert.match(panel, /<EarningsResultTable /);
  assert.match(readFileSync(new URL('../lib/research/earnings-table.ts', import.meta.url), 'utf8'), /export function moneyJa/);
  assert.match(panel, /japaneseMoney\(row\.result\.ja/);
  assert.match(panel, /japaneseMoney\(row\.body\.ja\)/);
});
