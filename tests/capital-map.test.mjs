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
  assert.match(header, /item\("\/research\/capital-map", "changes", ja \? "資本マップ" : "CAPITAL MAP"\)/);
  assert.doesNotMatch(header, /何が変わった？/);
});

test('reviewed SEC snapshots retain every security and reconcile to cover totals', () => {
  const data = JSON.parse(readFileSync(new URL('../lib/research/capital-map-disclosures.json', import.meta.url), 'utf8'));
  assert.deepEqual(data.map(p => p.current.holdings.length), [29, 8, 28]);
  assert.deepEqual(data.map(p => p.current.source.entryCount), [89, 8, 29]);
  for (const portfolio of data) {
    const current = portfolio.current;
    assert.equal(current.holdings.reduce((sum, row) => sum + row.value, 0), current.source.totalValue);
    assert.equal(new Set(current.holdings.map(row => row.securityId)).size, current.holdings.length);
    assert.ok(current.holdings.every(row => row.shares > 0 && Number.isSafeInteger(row.value)));
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
