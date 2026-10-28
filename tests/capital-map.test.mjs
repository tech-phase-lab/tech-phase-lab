import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { capitalRows, etfOverlap, parseCapitalPreferences } from '../lib/research/capital-map.ts';
import { capitalMapSamples } from '../lib/research/capital-map-sample.ts';

const holding = (ticker, shares, value, instrument = 'stock') => ({ securityId: ticker, ticker, name: ticker, shares, value, instrument });
const snapshot = (holdings, complete = true) => ({ id: 'test', asOf: '2026-06-30', publishedOn: '2026-08-14', complete, holdings });

test('price-driven weight changes never imply a change in shares', () => {
  const old = snapshot([holding('AAPL', 100, 1000), holding('NVDA', 100, 1000)]);
  const now = snapshot([holding('AAPL', 100, 2000), holding('NVDA', 100, 1000)]);
  const row = capitalRows(now, old).find(row => row.ticker === 'AAPL');
  assert.equal(row.change, 'unchanged');
  assert.equal(row.shareChangePercent, 0);
  assert.ok(Math.abs(row.weight - 200 / 3) < 1e-8);
  assert.equal(row.companyPercent, null);
});
test('holdings changes distinguish new, increased, reduced, exited and options', () => {
  const old = snapshot([holding('AAPL', 100, 1000), holding('NVDA', 200, 1000), holding('MU', 30, 300)]);
  const now = snapshot([holding('AAPL', 150, 1500), holding('NVDA', 100, 500), holding('NBIS', 50, 600), holding('AAPL', 100, 300, 'put')]);
  const rows = capitalRows(now, old);
  assert.equal(rows.find(row => row.ticker === 'AAPL' && row.instrument === 'stock').change, 'increased');
  assert.equal(rows.find(row => row.ticker === 'AAPL' && row.instrument === 'put').change, 'new');
  assert.equal(rows.find(row => row.ticker === 'NVDA').shareChangePercent, -50);
  assert.equal(rows.find(row => row.ticker === 'NBIS').change, 'new');
  assert.equal(rows.find(row => row.ticker === 'MU').change, 'exited');
});
test('missing or partial snapshots do not manufacture exits or new positions', () => {
  const old = snapshot([holding('AAPL', 100, 1000)], false);
  const now = snapshot([holding('NVDA', 100, 1000)], false);
  assert.deepEqual(capitalRows(now, old).map(row => row.change), ['unknown']);
  assert.equal(capitalRows(now)[0].change, 'unknown');
});
test('weighted overlap is symmetric and preserves distinct share classes', () => {
  const a = snapshot([holding('NVDA', 1, 50), holding('GOOG', 1, 50)]);
  const b = snapshot([holding('NVDA', 1, 25), holding('GOOGL', 1, 75)]);
  assert.equal(etfOverlap(a, b).percent, 25);
  assert.deepEqual(etfOverlap(a, b).rows.map(row => row.ticker), ['NVDA']);
  assert.equal(etfOverlap(b, a).percent, 25);
  assert.equal(etfOverlap(a, a).percent, 100);
  assert.equal(etfOverlap(a, snapshot([])).percent, 0);
});
test('ownership stays unavailable without verified outstanding shares and options do not imply ownership', () => {
  const rows = capitalRows(snapshot([{ ...holding('NVDA', 100, 1000), outstandingShares: 1000 }, { ...holding('MU', 100, 1000, 'put'), outstandingShares: 1000 }, { ...holding('NBIS', 100, 1000), outstandingShares: 0 }]));
  assert.equal(rows.find(row => row.ticker === 'NVDA').companyPercent, 10);
  assert.equal(rows.find(row => row.ticker === 'MU').companyPercent, null);
  assert.equal(rows.find(row => row.ticker === 'NBIS').companyPercent, null);
});
test('saved preferences reject corrupt values and discard unknown IDs and stock input', () => {
  assert.deepEqual(parseCapitalPreferences('{bad', ['a']), { saved: [], seen: {} });
  assert.deepEqual(parseCapitalPreferences(JSON.stringify({ saved: ['a', 'a', 'bad', 3], seen: { a: 'version-1', bad: 'version-2' }, query: 'NBIS' }), ['a']), { saved: ['a'], seen: { a: 'version-1' } });
});
test('synthetic holdings never leak into the live route or invent an institutional percentage', () => {
  for (const item of capitalMapSamples) {
    assert.ok(capitalRows(item.current).every(row => row.companyPercent === null));
    assert.ok(Math.abs(capitalRows(item.current).reduce((sum, row) => sum + row.weight, 0) - 100) < 1e-8);
  }
  const live = readFileSync(new URL('../app/research/capital-map/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(live, /capitalMapSamples|capital-map-sample/);
  const header = readFileSync(new URL('../app/research/site-header.tsx', import.meta.url), 'utf8');
  assert.match(header, /item\("\/research\/capital-map", "pulse", ja \? "資本マップ" : "Capital Map"\)/);
  assert.doesNotMatch(header, /何が変わった？/);
});

test('reviewed SEC snapshots retain every security and reconcile to cover totals', () => {
  const data = JSON.parse(readFileSync(new URL('../lib/research/capital-map-disclosures.json', import.meta.url), 'utf8'));
  assert.deepEqual(data.slice(0, 3).map(p => p.current.holdings.length), [29, 8, 28]);
  assert.deepEqual(data.slice(0, 3).map(p => p.current.source.entryCount), [89, 8, 29]);
  for (const portfolio of data.filter(p => p.kind !== 'etf')) {
    const current = portfolio.current;
    assert.equal(current.holdings.reduce((sum, row) => sum + row.value, 0), current.source.totalValue);
    assert.equal(new Set(current.holdings.map(row => `${row.securityId}:${row.instrument}`)).size, current.holdings.length);
    assert.ok(current.holdings.every(row => row.shares >= 0 && Number.isSafeInteger(row.value)));
    assert.ok(capitalRows(current).every(row => row.change === 'unknown' && row.companyPercent === null));
    assert.match(current.source.url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//);
  }
  const brk = data[0].current.holdings;
  assert.equal(brk.find(row => row.ticker === 'AAPL').shares, 227917808);
  assert.ok(brk.some(row => row.ticker === 'GOOG'));
  assert.ok(brk.some(row => row.ticker === 'GOOGL'));
  const alphabet = data[2].current.holdings;
  assert.equal(alphabet.find(row => row.ticker === 'FRSH').shares, 16206643);
});


test('issuer weights retain cash allocation instead of inflating equity weights', () => {
  const a = snapshot([{ ...holding('NVDA', 10, 100), reportedWeight: 40 }, { ...holding('GOOG', 5, 50), reportedWeight: 20 }]);
  const b = snapshot([{ ...holding('NVDA', 2, 0), reportedWeight: 15 }, { ...holding('GOOGL', 4, 0), reportedWeight: 70 }]);
  assert.deepEqual(capitalRows(a).map(row => row.weight), [40, 20]);
  assert.equal(etfOverlap(a, b).percent, 15);
  assert.equal(etfOverlap(a, a).percent, 60);
  assert.equal(etfOverlap(b, a).percent, 15);
});

test('expanded coverage preserves complete equity lists and issuer weights', () => {
  const data = JSON.parse(readFileSync(new URL('../lib/research/capital-map-disclosures.json', import.meta.url), 'utf8'));
  assert.equal(data.filter(p => p.kind === 'manager').length, 8);
  const etfs = data.filter(p => p.kind === 'etf');
  assert.deepEqual(etfs.map(p => [p.name, p.current.holdings.length]), [['SPY', 504], ['SMH', 25], ['SOXX', 30], ['XLK', 75], ['XLF', 76]]);
  for (const p of etfs) {
    const rows = capitalRows(p.current);
    assert.equal(new Set(rows.map(r => r.securityId)).size, rows.length);
    assert.ok(rows.every(r => r.weight === r.reportedWeight && r.shares > 0));
    const total = rows.reduce((sum, r) => sum + r.weight, 0);
    assert.ok(total > 98 && total <= 100.1);
    assert.match(p.current.source.sha256, /^[a-f0-9]{64}$/);
  }
  const spy = etfs.find(p => p.name === 'SPY').current;
  const smh = etfs.find(p => p.name === 'SMH').current;
  const nvda = etfOverlap(spy, smh).rows.find(r => r.ticker === 'NVDA');
  assert.equal(nvda.shared, 8.336249);
  const optionRows = data.filter(p => p.kind !== 'etf').flatMap(p => p.current.holdings).filter(r => r.instrument !== 'stock');
  assert.ok(optionRows.length > 0);
});

test('ACWI preserves full global holdings and never matches foreign listings to US ADRs', () => {
  const acwi = JSON.parse(readFileSync(new URL('../lib/research/capital-map-acwi.json', import.meta.url), 'utf8'));
  const data = JSON.parse(readFileSync(new URL('../lib/research/capital-map-disclosures.json', import.meta.url), 'utf8'));
  const spy = data.find(p => p.name === 'SPY');
  assert.equal(acwi.current.asOf, '2026-10-09');
  assert.equal(acwi.current.holdings.length, 2197);
  assert.equal(new Set(acwi.current.holdings.map(h => h.securityId)).size, 2197);
  assert.ok(Math.abs(capitalRows(acwi.current).reduce((sum, r) => sum + r.weight, 0) - 98.95) < 1e-8);
  assert.equal(etfOverlap(spy.current, acwi.current).rows.find(r => r.ticker === 'NVDA').shared, 5.06);
  assert.ok(etfOverlap(spy.current, acwi.current).rows.some(r => r.ticker === 'BRK.B'));
  const localTsm = acwi.current.holdings.find(h => h.ticker === '2330');
  assert.match(localTsm.securityId, /^acwi:Taiwan Stock Exchange:/);
  assert.ok(!etfOverlap(data.find(p => p.name === 'SMH').current, acwi.current).rows.some(r => r.ticker === 'TSM'));
  assert.match(acwi.current.source.sha256, /^[a-f0-9]{64}$/);
});

test('additional corporate reports reconcile full SEC totals and aggregate duplicate managers', () => {
  const data = JSON.parse(readFileSync(new URL('../lib/research/capital-map-corporate.json', import.meta.url), 'utf8'));
  assert.deepEqual(data.map(p => p.name), ['Amazon', 'Intel', 'Cisco']);
  for (const p of data) {
    assert.equal(p.kind, 'corporate');
    assert.equal(p.current.asOf, '2026-06-30');
    assert.equal(p.current.complete, true);
    assert.equal(p.current.holdings.reduce((sum, h) => sum + h.value, 0), p.current.source.totalValue);
    assert.equal(new Set(p.current.holdings.map(h => `${h.securityId}:${h.instrument}`)).size, p.current.holdings.length);
    assert.ok(capitalRows(p.current).every(h => h.change === 'unknown'));
  }
  const intel = data.find(p => p.name === 'Intel');
  assert.equal(intel.current.source.entryCount, 3);
  assert.equal(intel.current.holdings.length, 2);
  assert.equal(intel.current.holdings.find(h => h.ticker === 'JOBY').value, 136621529);
  const cisco = data.find(p => p.name === 'Cisco');
  assert.equal(cisco.current.holdings.find(h => h.ticker === 'ITOT').securityId, '464287150');
  assert.equal(cisco.current.holdings.find(h => h.ticker === 'IVV').securityId, '464287200');
  assert.equal(data.find(p => p.name === 'Amazon').current.holdings.find(h => h.ticker === 'RIVN').value, 2747612520);
});

test('prior-quarter reports reconcile and cover all managers and corporate portfolios', () => {
  const load = name => JSON.parse(readFileSync(new URL(`../lib/research/${name}.json`, import.meta.url), 'utf8'));
  const portfolios = [...load('capital-map-disclosures'), ...load('capital-map-corporate')].filter(p => p.kind !== 'etf');
  const history = load('capital-map-history');
  assert.deepEqual(Object.keys(history).sort(), portfolios.map(p => p.id).sort());
  for (const p of portfolios) {
    const prior = history[p.id];
    assert.equal(prior.asOf, '2026-03-31');
    assert.equal(prior.complete, true);
    assert.ok(prior.publishedOn < p.current.publishedOn);
    assert.notEqual(prior.id, p.current.id);
    assert.equal(prior.holdings.reduce((sum, h) => sum + h.value, 0), prior.source.totalValue);
    assert.equal(new Set(prior.holdings.map(h => `${h.securityId}:${h.instrument}`)).size, prior.holdings.length);
    assert.ok(prior.source.entryCount >= prior.holdings.length);
    assert.match(prior.source.sha256, /^[a-f0-9]{64}$/);
    assert.equal(Number(prior.source.url.split('/')[6]), Number(p.current.source.url.split('/')[6]));
  }
  const intel = portfolios.find(p => p.id === 'intel-13f');
  assert.equal(history[intel.id].source.entryCount, 3);
  assert.equal(history[intel.id].holdings.find(h => h.ticker === 'JOBY').shares, 15316315);
  assert.ok(capitalRows(intel.current, history[intel.id]).every(h => h.change === 'unchanged' && h.shareChangePercent === 0));
  const amazon = portfolios.find(p => p.id === 'amazon-13f');
  const rows = capitalRows(amazon.current, history[amazon.id]);
  assert.equal(rows.find(h => h.ticker === 'RIVN').change, 'unchanged');
  assert.equal(rows.find(h => h.ticker === 'ALGT').change, 'new');
  assert.equal(rows.find(h => h.securityId === '63909J108').change, 'exited');
});

test('additional managers reconcile full reports including bonds and restated history', () => {
  const data = JSON.parse(readFileSync(new URL('../lib/research/capital-map-additional-managers.json', import.meta.url), 'utf8'));
  assert.deepEqual(data.map(p => p.id), ['thiel-13f', 'soros-13f', 'ark-13f', 'jpmorgan-13f', 'blackrock-13f']);
  assert.deepEqual(data.map(p => p.current.source.entryCount), [8, 266, 191, 34064, 49968]);
  assert.deepEqual(data.map(p => p.current.source.totalValue), [418666506, 8143628824, 15402788184, 1807041234839, 6729538649155]);
  assert.deepEqual(data.map(p => p.current.holdings.length), [8, 266, 191, 7720, 5696]);
  for (const p of data) {
    for (const [period, date] of [['current', '2026-06-30'], ['previous', '2026-03-31']]) {
      const snapshot = p[period];
      assert.equal(snapshot.asOf, date);
      assert.equal(snapshot.complete, true);
      assert.equal(snapshot.holdings.reduce((sum, h) => sum + h.value, 0), snapshot.source.totalValue);
      assert.equal(new Set(snapshot.holdings.map(h => `${h.securityId}:${h.instrument}`)).size, snapshot.holdings.length);
      assert.match(snapshot.source.sha256, /^[a-f0-9]{64}$/);
      assert.ok(snapshot.holdings.every(h => Number.isSafeInteger(h.value) && Number.isSafeInteger(h.shares) && h.value >= 0 && h.shares >= 0));
      assert.equal(Number(snapshot.source.url.split('/')[6]), Number(p.current.source.url.split('/')[6]));
    }
    const rows = capitalRows(p.current, p.previous);
    assert.ok(Math.abs(rows.reduce((sum, h) => sum + h.weight, 0) - 100) < 1e-8);
    assert.ok(rows.every(h => h.companyPercent === null));
  }
  assert.equal(data[3].previous.source.accession, '000001961726000225'); // Full restatement, not additive amendment.
  assert.deepEqual(data[0].previous.holdings, []); // SEC's zero-value NA placeholder is not a security.
  assert.ok(capitalRows(data[0].current, data[0].previous).every(h => h.change === 'new'));
  for (const p of [data[1], data[3], data[4]]) assert.ok(p.current.holdings.some(h => h.instrument === 'bond'));
});

test('bond principal stays distinct from stock shares and never implies company ownership', () => {
  const bond = { ...holding('NOTE', 100000, 90000, 'bond'), outstandingShares: 1000000 };
  const rows = capitalRows(snapshot([bond]), snapshot([{ ...bond, shares: 200000 }]));
  assert.equal(rows[0].shareChangePercent, -50);
  assert.equal(rows[0].companyPercent, null);
  assert.equal(etfOverlap(snapshot([bond]), snapshot([bond])).percent, 0);
});

test('the public Capital Map returns actual reports without membership or a paid-plan claim', async () => {
  const { build } = await import('esbuild');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const compiled = await build({
    entryPoints: [new URL('../app/research/capital-map/page.tsx', import.meta.url).pathname],
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external',
    plugins: [{ name: 'public-route-test', setup(builder) {
      builder.onResolve({ filter: /^\.\/screen$/ }, () => ({ path: 'screen', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export default function CapitalMap() {}' }));
      builder.onResolve({ filter: /membership\/server|@clerk\/nextjs|research\/comparison$/ }, () => {
        throw new Error('Public holdings must not depend on membership or PRO authorization');
      });
    } }],
  });
  const compiledModule = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, compiledModule, compiledModule.exports);
  const result = await compiledModule.exports.default();
  assert.equal(result.props.mode, 'reports');
  assert.equal(result.props.portfolios.length, 24);
  assert.equal(result.props.portfolios.filter(p => p.kind === 'manager').length, 13);
  assert.ok(result.props.portfolios.every(p => p.current.holdings.length > 0 && p.current.source.url.startsWith('https://')));
  assert.ok(result.props.portfolios.filter(p => p.kind !== 'etf').every(p => p.previous?.asOf === '2026-03-31'));
  const screen = readFileSync(new URL('../app/research/capital-map/screen.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(screen, /TECH PHASE PRO|Sign in \/ View plan/);
  const dashboard = readFileSync(new URL('../app/research/research-dashboard.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(dashboard, /<li><strong>\{t\("資本マップ"/);
  assert.match(dashboard, /href="\/research\/capital-map"/);
});
