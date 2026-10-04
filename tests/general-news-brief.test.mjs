import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import reportedNewsTickers from '../lib/research/reported-news-tickers.json' with { type: 'json' };
import { availableNewsPayload, publicNewsPayload } from '../lib/research/general-news.ts';
import { officialNewsDisplay } from '../lib/research/news-presentation.ts';
import { newsPulseItems } from '../lib/research/news-pulse-items.ts';
import { buildPublicNews } from '../lib/research/public-news-response.ts';

// Synthetic reviewed facts; no claim about a live source or company.
const suffixEn = ' (brief; details awaiting review)', suffixJa = '（短報・詳細確認中）';
const sector = { id: '8044', title: 'Broker industry outlook' + suffixEn,
  translationJa: '証券会社による業界見通し' + suffixJa,
  url: 'https://x.com/wallstengine/status/8044', publisher: 'Reported industry news', tickers: [],
  generalSource: 1, brief: { version: 1, scope: 'sector', validFacts: 2, pendingFacts: 1 },
  publishedAt: '2026-10-02T12:30:37.000Z', observedAt: '2026-10-02T12:49:12.663+00:00',
  bodyJa: '供給能力の逼迫が報告されている。\n新規設備の準備には時間がかかる。',
  bodyEn: 'Suppliers report tighter capacity.\nPreparing new facilities takes time.' };
const company = { ...sector, id: '8045', title: 'NVIDIA announces new capacity' + suffixEn,
  translationJa: 'NVIDIA、新たな供給能力を発表' + suffixJa, url: 'https://x.com/TipRanks/status/8045',
  publisher: 'TipRanks', tickers: ['NVDA'], brief: { version: 1, scope: 'company', validFacts: 1, pendingFacts: 2 } };
const payload = officialUpdates => ({ ok: true, enabled: false, items: [], officialUpdates });
const parse = item => publicNewsPayload(payload([item])).officialUpdates[0];

test('public reported-news ticker registry exactly matches both existing approved X source scopes', async () => {
  const sources = JSON.parse(await readFile(new URL('../scripts/research/signal_sources.json', import.meta.url), 'utf8'));
  assert.equal(reportedNewsTickers.length, 33);
  assert.equal(new Set(reportedNewsTickers).size, reportedNewsTickers.length);
  for (const id of ['x-tipranks', 'x-wallstengine']) {
    const source = sources.find(source => source.id === id);
    assert.ok(source, `${id} must remain an explicitly configured source`);
    const approved = [...new Set([...source.tickers, ...source.extraTickers])].sort();
    assert.deepEqual(reportedNewsTickers, approved, `${id} approved ticker scope drifted`);
  }
});

test('company briefs accept approved ALAB and LITE reports without admitting unapproved tickers', () => {
  for (const ticker of ['ALAB', 'LITE']) for (const account of ['TipRanks', 'wallstengine']) {
    const item = { ...company, tickers: [ticker], url: `https://x.com/${account}/status/8045`,
      title: `${ticker} announces new capacity${suffixEn}`, translationJa: `${ticker}、新たな供給能力を発表${suffixJa}` };
    assert.deepEqual(parse(parse(item)), item);
    assert.equal(officialNewsDisplay(parse(item), 'en').label, `Company brief · ${ticker} · Details awaiting review`);
  }
  for (const ticker of ['AAPL', 'TSLA', 'UNTRACKED', 'ECON']) {
    assert.throws(() => parse({ ...company, tickers: [ticker] }), /Invalid news brief/);
  }
});

test('verified partial news survives repeated server and browser validation with original identity and clocks', () => {
  for (const item of [sector, company]) {
    const approved = parse({ ...item, text: 'PRIVATE SOURCE', evidence: 'PRIVATE EVIDENCE',
      brief: { ...item.brief, reviewer: 'PRIVATE REVIEWER' } });
    assert.deepEqual(approved, item);
    assert.deepEqual(parse(approved), approved);
    assert.deepEqual(availableNewsPayload(availableNewsPayload(payload([approved]))).officialUpdates, [approved]);
    const built = buildPublicNews(payload([approved]));
    assert.deepEqual(built.officialUpdates.find(row => row.id === item.id), approved);
    assert.equal(JSON.stringify(built).includes('PRIVATE'), false);
  }
});

test('old-client projections keep pending-review status after unknown brief fields are dropped', () => {
  for (const item of [sector, company]) {
    const approved = parse({ ...item, shortTitleJa: item.translationJa, shortTitleEn: item.title });
    const projected = { ...approved };
    delete projected.brief;
    delete projected.generalSource;
    assert.deepEqual(parse(projected), projected);
    for (const lang of ['ja', 'en']) {
      const suffix = lang === 'ja' ? suffixJa : suffixEn;
      const title = lang === 'ja' ? projected.translationJa : projected.title;
      const compactTitle = lang === 'ja' ? projected.shortTitleJa : projected.shortTitleEn;
      assert.ok(title.endsWith(suffix));
      assert.ok(compactTitle.endsWith(suffix));
      assert.equal(officialNewsDisplay(projected, lang).title, title);
      const [pulse] = newsPulseItems(payload([projected]), lang);
      assert.equal(pulse.title, title);
      assert.equal(pulse.shortTitle, compactTitle);
      const current = officialNewsDisplay(approved, lang);
      assert.equal(current.title, title.slice(0, -suffix.length));
      assert.equal((JSON.stringify(current).match(/details awaiting review|詳細は確認中/gi) ?? []).length, 1);
    }
  }
});

test('every brief headline and optional compact headline must retain exact bounded review status', () => {
  for (const item of [sector, company]) for (const [key, suffix] of [
    ['title', suffixEn], ['translationJa', suffixJa], ['shortTitleEn', suffixEn], ['shortTitleJa', suffixJa],
  ]) {
    for (const title of ['Company update', suffix, ' ' + suffix, 'Company update' + suffix + ' ', null]) {
      assert.throws(() => parse({ ...item, [key]: title }));
    }
  }
  for (const [key, suffix] of [['title', suffixEn], ['translationJa', suffixJa]]) {
    const title = 'x'.repeat(180 - Array.from(suffix).length) + suffix;
    assert.equal(parse({ ...company, [key]: title })[key], title);
    assert.throws(() => parse({ ...company, [key]: 'x' + title }));
  }
});

test('brief admission requires exact approved sources, explicit origin and valid fact counts', () => {
  const invalid = [
    { generalSource: undefined }, { generalSource: 0 }, { generalSource: '1' }, { generalSource: true },
    { brief: null }, { brief: [] }, { brief: {} }, { brief: 'partial' },
    { brief: { ...sector.brief, version: 2 } }, { brief: { ...sector.brief, version: true } },
    { brief: { ...sector.brief, scope: 'economic' } },
    ...['validFacts', 'pendingFacts'].flatMap(key => [undefined, 0, -1, 8, 1.5, '1', true, NaN, Infinity]
      .map(value => ({ brief: { ...sector.brief, [key]: value } }))),
    { brief: { ...sector.brief, validFacts: 4, pendingFacts: 5 } },
    ...['https://x.com/nebiusai/status/8044', 'https://x.com/theflynews/status/8044',
      'https://x.com/fabymetal4/status/8044', 'https://x.com/unknown/status/8044',
      'https://nebius.com/blog/8044', 'https://x.com/wallstengine/status/no-id',
      'https://x.com:443/wallstengine/status/8044', 'https://user:pass@x.com/wallstengine/status/8044',
      'http://x.com/wallstengine/status/8044', 'https://x.com/wallstengine/status/8044/',
      sector.url + '?', sector.url + '?unreviewed=1', sector.url + '#', sector.url + '#source']
      .map(url => ({ url })),
  ];
  for (const change of invalid) assert.throws(() => parse({ ...sector, ...change }), JSON.stringify(change));
  for (const [validFacts, pendingFacts] of [[1, 1], [1, 7], [7, 1], [4, 4]]) {
    assert.deepEqual(parse({ ...sector, brief: { ...sector.brief, validFacts, pendingFacts } }).brief,
      { ...sector.brief, validFacts, pendingFacts });
  }
});

test('briefs need both bounded bodies and a scope-consistent explicit tracked ticker', () => {
  for (const item of [sector, company]) {
    for (const key of ['bodyJa', 'bodyEn']) for (const value of [undefined, null, '', ' \n ', 'x\0y', 'x'.repeat(12001)]) {
      assert.throws(() => parse({ ...item, [key]: value }));
    }
    assert.equal(parse({ ...item, bodyJa: 'あ'.repeat(12000), bodyEn: 'x'.repeat(12000) }).bodyJa.length, 12000);
  }
  for (const tickers of [['MU'], ['NVDA'], ['ECON']]) assert.throws(() => parse({ ...sector, tickers }));
  for (const tickers of [[], ['UNTRACKED'], ['ECON'], ['NVDA', 'MU'], ['NVDA', 'NVDA']]) {
    assert.throws(() => parse({ ...company, tickers }));
  }
  const mentioned = parse({ ...sector, bodyEn: 'Micron appears in this industry report.' });
  assert.deepEqual(mentioned.tickers, []);
  assert.equal(mentioned.title, sector.title);
});

test('sector briefs reject company headlines and compact copy even with empty tickers', () => {
  for (const change of [
    { title: 'Micron upgraded as memory supply tightens' + suffixEn },
    { translationJa: 'マイクロン、メモリー供給逼迫で評価引き上げ' + suffixJa },
    { translationJa: undefined }, { publisher: 'Micron' }, { publisher: 'Wall St Engine' },
    { shortTitleEn: 'MU benefits from tighter memory supply' + suffixEn },
    { shortTitleJa: 'MU、メモリー供給逼迫の恩恵' + suffixJa },
    { shortTitleJa: sector.translationJa, shortTitleEn: 'Micron outlook improves' + suffixEn },
    { shortTitleJa: 'マイクロンの見通し改善' + suffixJa, shortTitleEn: sector.title },
  ]) {
    const invalid = { ...sector, ...change, tickers: [] };
    assert.throws(() => parse(invalid), /Invalid (sector brief|brief review status)/);
    assert.deepEqual(availableNewsPayload(payload([invalid, company])).officialUpdates, [company]);
  }
  const compactSector = { ...sector, shortTitleJa: sector.translationJa, shortTitleEn: sector.title };
  assert.deepEqual(parse(compactSector), compactSector);
  assert.deepEqual(parse(parse(compactSector)), compactSector);
  for (const lang of ['ja', 'en']) {
    const [pulse] = newsPulseItems(availableNewsPayload(payload([compactSector])), lang);
    assert.equal(pulse.shortTitle, lang === 'ja' ? '証券会社による業界見通し' : 'Broker industry outlook');
    assert.doesNotMatch(JSON.stringify(pulse), /\bMU\b|Micron|マイクロン/);
  }
  const compactCompany = { ...company, shortTitleJa: 'NVIDIAの供給能力' + suffixJa, shortTitleEn: 'NVIDIA capacity' + suffixEn };
  assert.deepEqual(parse(parse(compactCompany)), compactCompany);
});

test('invalid brief isolation preserves adjacent full articles without relaxing existing source validation', () => {
  const full = { ...sector, id: '8046', url: 'https://x.com/wallstengine/status/8046', brief: undefined, generalSource: undefined };
  const feed = availableNewsPayload(payload([{ ...sector, brief: { ...sector.brief, pendingFacts: 0 } }, full, company]));
  assert.deepEqual(feed.officialUpdates, [parse(full), company]);
  for (const change of [{ id: 'not-numeric' }, { observedAt: 'not-a-date' }, { publishedAt: 'not-a-date' },
    { title: 'x'.repeat(181) }, { translationJa: 'あ'.repeat(181) }, { researchId: 'unverified' }]) {
    assert.throws(() => parse({ ...company, ...change }));
  }
});

test('a full article promotes the same brief in place without duplicate stories or changed clocks', () => {
  const full = { ...company };
  delete full.brief;
  delete full.generalSource;
  full.title = full.title.slice(0, -suffixEn.length);
  full.translationJa = full.translationJa.slice(0, -suffixJa.length);
  full.bodyJa += '\n追加の事実を確認した。';
  full.bodyEn += '\nAn additional fact has been verified.';
  for (const rows of [[company, full], [full, company], [company, company, full, full]]) {
    assert.deepEqual(availableNewsPayload(payload(rows)).officialUpdates, [full]);
  }
  assert.deepEqual(parse({ ...full, generalSource: 1 }), full);
  const unchanged = officialNewsDisplay(full, 'en');
  assert.equal(unchanged.label, 'Company news · NVDA');
  assert.equal(unchanged.title, full.title);
  assert.doesNotMatch(unchanged.label, /brief|awaiting/i);
  assert.deepEqual(availableNewsPayload(payload([company, company])).officialUpdates, [company]);
});

test('company and sector briefs label pending review in both languages without adding a ticker or headline', () => {
  for (const lang of ['ja', 'en']) {
    const industry = officialNewsDisplay(parse(sector), lang);
    const companyDisplay = officialNewsDisplay(parse(company), lang);
    assert.equal(industry.label, lang === 'ja' ? '業界短報 · 詳細は確認中' : 'Industry brief · Details awaiting review');
    assert.equal(companyDisplay.label, lang === 'ja' ? '企業短報 · NVDA · 詳細は確認中' : 'Company brief · NVDA · Details awaiting review');
    assert.equal(industry.title, lang === 'ja' ? '証券会社による業界見通し' : 'Broker industry outlook');
    assert.doesNotMatch(JSON.stringify(industry), /\bMU\b|Micron|マイクロン/);
    const [pulse] = newsPulseItems(availableNewsPayload(payload([sector])), lang);
    assert.equal(pulse.ticker, industry.label);
    assert.equal(pulse.title, industry.title);
    assert.equal(pulse.shortTitle, industry.title);
    assert.equal(pulse.at, sector.publishedAt);
  }
});
