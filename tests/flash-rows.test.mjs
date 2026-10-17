import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { FLASH_TICKERS, WATCH_TICKERS, flashRows } from '../lib/research/flash-rows.ts';
import { earningsOnlyProviders } from '../lib/research/intake.ts';

const base = { url: 'https://www.example.com/a', publisher: 'Co', observedAt: '2026-10-14T01:00:00Z' };
const wireItem = (id, titleJa, publishedAt) => ({ id, titleEn: `en ${id}`, titleJa, publisher: 'Wire', origin: 'wire', url: `https://example.com/${id}`, publishedAt });

test('the roster is the 22 watched stocks plus the 15 earnings-only stocks', () => {
  assert.equal(WATCH_TICKERS.size, 22);
  assert.equal(earningsOnlyProviders.length, 15);
  assert.equal(FLASH_TICKERS.length, 37);
  assert.ok(earningsOnlyProviders.every(p => FLASH_TICKERS.includes(p.ticker) && !WATCH_TICKERS.has(p.ticker)));
});

test('live monitor rows come from watched stocks only, newest first, earnings releases kept out of them', () => {
  const [watched] = [...WATCH_TICKERS];
  const [earningsOnly] = earningsOnlyProviders.map(p => p.ticker);
  const feed = { officialUpdates: [
    { ...base, id: 'a', tickers: [watched], title: `${watched} launches a product`, translationJa: '製品を発表', publishedAt: '2026-10-14T03:00:00Z' },
    { ...base, id: 'b', tickers: [earningsOnly], title: `${earningsOnly} launches a product`, translationJa: '対象外', publishedAt: '2026-10-14T04:00:00Z' },
    { ...base, id: 'c', tickers: [watched], title: `${watched} reports third quarter results`, translationJa: '決算', publishedAt: '2026-10-14T05:00:00Z' },
    { ...base, id: 'd', tickers: [watched], title: `${watched} has no stated time`, translationJa: '時刻なし', observedAt: '2026-10-14T05:30:00Z' },
  ] };
  const wire = { [watched]: [wireItem('w1', '配信見出し', '2026-10-14T06:00:00Z'), wireItem('w2', null, '2026-10-14T07:00:00Z')],
    [earningsOnly]: [wireItem('w3', '対象外の配信', '2026-10-14T08:00:00Z')] };
  const ids = flashRows(feed, wire, 'ja').filter(row => row.kind === 'news').map(row => row.id);
  assert.deepEqual(ids, ['wire:w1', 'official:a']);
});

test('earnings rows cover all 37 stocks; the Japanese view leaves out an unchecked translation', () => {
  const [earningsOnly] = earningsOnlyProviders.map(p => p.ticker);
  const brief = (id, ticker, titleJa) => ({ id, kind: 'earnings', ticker, period: 'Q3', titleJa, titleEn: `${ticker} Q3`, publishedAt: '2026-10-14T05:00:00Z', url: `https://x.com/a/status/${id}`, publisher: 'X', facts: [] });
  const feed = { resultBriefs: [brief('1', earningsOnly, '決算速報'), brief('2', 'ZZZZ', '対象外'), brief('3', 'MU', null)] };
  const ja = flashRows(feed, {}, 'ja').filter(row => row.kind === 'earnings');
  assert.deepEqual(ja.map(row => row.tickers[0]), [earningsOnly]);
  const en = flashRows(feed, {}, 'en').filter(row => row.kind === 'earnings');
  assert.deepEqual(en.map(row => row.tickers[0]).sort(), [earningsOnly, 'MU'].sort());
});

test('the page has All / Earnings tabs only, shows one date heading per day (month/day), and no source line or stock filter', async () => {
  const source = await readFile(new URL('../app/research/news/flash-page.tsx', import.meta.url), 'utf8');
  assert.match(source, /\["all", "earnings"\] as const/);
  assert.doesNotMatch(source, /銘柄で絞る|<select/);
  assert.match(source, /ニュース取得リスト/);
  assert.match(source, /className=\{styles\.day\}/);
  assert.doesNotMatch(source, /timeline\.src|row\.source/);
  assert.match(source, /const dayKey = /);
  assert.match(source, /\$\{Number\(month\)\}\/\$\{Number\(day\)\}/);
  assert.doesNotMatch(source, /<time dateTime=\{row\.at\}><span>/);
  assert.doesNotMatch(source, /公式発表/);
  const page = await readFile(new URL('../app/research/news/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /"ハイテク速報" : "Tech Alerts"/);
});

test('a company X account post with no business content is left out (owner, Oct 16: Builders & Brews tour)', async () => {
  const { socialChatter } = await import('../lib/research/news-presentation.ts');
  const base = { id: '1', publisher: 'X · Nebius official', url: 'https://x.com/nebiusai/status/1', tickers: ['NBIS'], observedAt: '2026-10-15T21:27:40Z', publishedAt: '2026-10-15T21:27:33Z' };
  assert.equal(socialChatter({ ...base, title: 'The Builders & Brews tour has wrapped: thousands of builders in 20 cities', translationJa: '20都市・17カ国の数千人のビルダーが参加したBuilders & Brewsツアーが終了しました。' }), true);
  assert.equal(socialChatter({ ...base, title: 'Nebius signs a multi-year agreement to supply GPU capacity', translationJa: 'Nebius、GPU容量の複数年契約を締結' }), false);
  assert.equal(socialChatter({ ...base, url: 'https://www.nvidia.com/blog/x', title: 'Builders tour', translationJa: 'ツアー' }), false);
});
