import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { FLASH_TICKERS, WATCH_TICKERS, flashRows } from '../lib/research/flash-rows.ts';
import { earningsOnlyProviders } from '../lib/research/intake.ts';

const base = { url: 'https://www.example.com/a', publisher: 'Co', observedAt: '2026-10-14T01:00:00Z' };
const wireItem = (id, titleJa, publishedAt) => ({ id, titleEn: `en ${id}`, titleJa, publisher: 'Wire', origin: 'wire', url: `https://example.com/${id}`, publishedAt });

test('the roster is the 22 watched stocks plus the 28 earnings-only stocks', () => {
  assert.equal(WATCH_TICKERS.size, 22);
  assert.equal(earningsOnlyProviders.length, 28);
  assert.equal(FLASH_TICKERS.length, 50);
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

test('earnings rows cover every announced result, as the calendar does; the Japanese view leaves out an unchecked translation', () => {
  const [earningsOnly] = earningsOnlyProviders.map(p => p.ticker);
  const brief = (id, ticker, titleJa) => ({ id, kind: 'earnings', ticker, period: 'Q3', titleJa, titleEn: `${ticker} Q3`, publishedAt: '2026-10-14T05:00:00Z', url: `https://x.com/a/status/${id}`, publisher: 'X', facts: [] });
  const feed = { resultBriefs: [brief('1', earningsOnly, '決算速報'), brief('2', 'ZZZZ', '対象外'), brief('3', 'MU', null)] };
  const ja = flashRows(feed, {}, 'ja').filter(row => row.kind === 'earnings');
  assert.deepEqual(ja.map(row => row.tickers[0]).sort(), [earningsOnly, 'ZZZZ'].sort());
  const en = flashRows(feed, {}, 'en').filter(row => row.kind === 'earnings');
  assert.deepEqual(en.map(row => row.tickers[0]).sort(), [earningsOnly, 'MU', 'ZZZZ'].sort());
});

test('the page has All / Earnings tabs only, shows one date heading per day (month/day), and no source line or stock filter', async () => {
  const source = await readFile(new URL('../app/research/news/flash-page.tsx', import.meta.url), 'utf8');
  assert.match(source, /\["all", "earnings"\] as const/);
  assert.doesNotMatch(source, /銘柄で絞る|<select/);
  assert.match(source, /ニュース取得リスト/);
  // Earnings rows of stocks outside the 22 (Tesla, Meta, Lam Research) must survive the page filter (owner, Oct 22).
  assert.match(source, /row\.kind === "earnings" \|\| row\.tickers\.some\(ticker => WATCH_TICKERS\.has\(ticker\)\)/);
  assert.match(source, /className=\{styles\.day\}/);
  assert.doesNotMatch(source, /timeline\.src|row\.source/);
  assert.match(source, /const flashDayKey = /);
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

test('conference session blogs and earnings "highlights" pages are not listed as news', async () => {
  const { isNotNews } = await import('../lib/research/news-presentation.ts');
  assert.equal(isNotNews({ title: 'GTC: How Vertiv and NVIDIA Cut AI Factory Deployment Time in Half' }), true);
  assert.equal(isNotNews({ title: 'Bloom Energy Announces Third Quarter 2026 Earnings Highlights: Record Results' }), true);
  assert.equal(isNotNews({ title: 'Bloom Energy Q3 2026 Highlights' }), true);
  assert.equal(isNotNews({ title: 'Vertiv launches a new liquid cooling product' }), false);
  assert.equal(isNotNews({ title: 'NVIDIA announces new GTC dates' }), false);
  assert.equal(isNotNews({ title: "JCC's new lab: where Micron's future workforce grows" }), true);
  assert.equal(isNotNews({ title: 'Washington bans DeepSeek, Microsoft drops UK project: This Week\'s Key Developments' }), true);
  assert.equal(isNotNews({ title: 'Tech week in review', translationJa: 'テック週間まとめ' }), true);
  assert.equal(isNotNews({ title: 'Washington bans DeepSeek', translationJa: 'ワシントン、DeepSeekを禁止：今週の主な動向' }), true);
  assert.equal(isNotNews({ title: 'Microsoft reports earnings this week' }), false);
});

test('a date-only release shows and sorts by when the monitor first saw it that day (owner, Nov 26: rows showed no time)', async () => {
  const { flashInstant, flashAlerts } = await import('../lib/research/flash-rows.ts');
  const [watched] = [...WATCH_TICKERS];
  const row = (id, extra) => ({ ...base, id, tickers: [watched], title: `${watched} product ${id}`, translationJa: `製品 ${id}`, ...extra });
  const feed = { officialUpdates: [
    row('stated', { publishedAt: '2026-11-24T19:30:00Z', observedAt: '2026-11-24T19:31:00Z' }),
    row('dated', { publishedOn: '2026-11-24', observedAt: '2026-11-24T21:05:00Z' }),
    row('early', { publishedOn: '2026-11-24', observedAt: '2026-11-24T08:10:00Z' }),
    row('late', { publishedOn: '2026-11-20', observedAt: '2026-11-24T10:00:00Z' }),
    row('both', { publishedAt: '2026-11-24T16:00:00Z', publishedOn: '2026-11-24', observedAt: '2026-11-24T16:02:00Z' }),
  ] };
  const rows = flashRows(feed, {}, 'ja').filter(r => r.kind === 'news');
  assert.deepEqual(rows.map(r => r.id), ['official:dated', 'official:stated', 'official:both', 'official:early', 'official:late']);
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.deepEqual([byId['official:dated'].at, byId['official:dated'].timeKind], ['2026-11-24T21:05:00.000Z', 'found']);
  assert.equal(byId['official:both'].timeKind, 'published', 'a stated publication time wins over the date');
  // Found later than its day allows (an old release found again): keeps just its date.
  assert.deepEqual([byId['official:late'].at, byId['official:late'].timeKind], ['2026-11-20', 'date']);
  assert.equal(flashInstant(byId['official:dated']), Date.parse('2026-11-24T21:05:00Z'));
  // A first-seen time never raises the NEW dot as if it were a publication time.
  const alerts = flashAlerts(feed, {}, Date.parse('2026-11-24T22:00:00Z')).map(a => a.id);
  assert.ok(!alerts.includes('official:dated') && alerts.includes('official:stated'));
});

test('firstSeenOnDay allows every zone of the stated day and nothing later', async () => {
  const { firstSeenOnDay } = await import('../lib/research/news-time.ts');
  assert.equal(firstSeenOnDay('2026-11-24', '2026-11-23T10:00:00Z'), '2026-11-23T10:00:00.000Z'); // UTC+14 morning
  assert.equal(firstSeenOnDay('2026-11-24', '2026-11-25T11:59:00Z'), '2026-11-25T11:59:00.000Z'); // UTC-12 evening
  assert.equal(firstSeenOnDay('2026-11-24', '2026-11-23T09:59:00Z'), null);
  assert.equal(firstSeenOnDay('2026-11-24', '2026-11-25T12:01:00Z'), null);
  assert.equal(firstSeenOnDay('2026-11-24', undefined), null);
  assert.equal(firstSeenOnDay('2026-11-24T10:00:00Z', '2026-11-24T10:00:00Z'), null);
});

test('the company timeline sorts a date-only source by when it was first seen that day', async () => {
  const source = await readFile(new URL('../app/research/companies/company-activity.tsx', import.meta.url), 'utf8');
  assert.match(source, /firstSeenOnDay\(row\.at, row\.observedAt\)/);
  assert.match(source, /\.sort\(\(a, b\) => rowInstant\(b\) - rowInstant\(a\)\)/);
});

test('a first-seen time on 速報 is labelled 取得 / Found above the clock, in the company timeline style (owner, Nov 26)', async () => {
  const source = await readFile(new URL('../app/research/news/flash-page.tsx', import.meta.url), 'utf8');
  assert.match(source, /row\.timeKind === "found"\) return <time dateTime=\{row\.at\}><span className=\{timeline\.found\}>\{lang === "ja" \? "取得" : "Found"\}<\/span>\{displayClock\(row\.at, lang\)\}<\/time>/);
  assert.match(source, /import timeline from "\.\.\/companies\/company-activity\.module\.css"/);
  const css = await readFile(new URL('../app/research/companies/company-activity.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.found\{display:block;font-size:9\.5px;letter-spacing:0;color:#6f7b8c\}/);
  // The company timeline uses the same English word for found times.
  const company = await readFile(new URL('../app/research/companies/company-activity.tsx', import.meta.url), 'utf8');
  assert.match(company, /styles\.found\}>\{lang === "ja" \? "取得" : "Found"\}/);
});

test('new rows on 速報 and on the home news list pulse like the fresh monitor dot, and hold still with reduced motion (owner, Nov 26)', async () => {
  const flash = await readFile(new URL('../app/research/news/flash-page.tsx', import.meta.url), 'utf8');
  assert.match(flash, /marked\(row\) \? timeline\.unread : ""/);
  const css = await readFile(new URL('../app/research/companies/company-activity.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.unread \.node\{animation:nodeFlash \.9s infinite\}/);
  assert.match(css, /@keyframes nodeFlash\{0%\{box-shadow:0 0 0 0 rgba\(93,255,180,\.8\)[^}]*\}70%\{box-shadow:0 0 0 11px rgba\(93,255,180,0\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{[^}]*\.unread \.node\{animation:none\}/);
  const home = await readFile(new URL('../app/research/news/general-news.module.css', import.meta.url), 'utf8');
  assert.match(home, /\.tlFresh \.tlRail i\{animation:newBlink \.9s infinite\}/);
  assert.match(home, /@keyframes newBlink\{0%\{box-shadow:0 0 0 0 rgba\(93,255,180,\.8\)[^}]*\}70%\{box-shadow:0 0 0 11px rgba\(93,255,180,0\)/);
  assert.match(home, /@media\(prefers-reduced-motion:reduce\)\{\.tlFresh \.tlRail i\{animation:none\}\}/);
});
