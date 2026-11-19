import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { benchmarkFor, marketReaction, newYorkTime, parseMarketReaction } from '../lib/research/market-reaction.ts';

// Real daily bars (Twelve Data, read once into the fixture): NVIDIA reported after the close on Aug 26, 2026. No live calls in tests.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/market-reaction-nvda-smh.json', import.meta.url), 'utf8'));
const smh = benchmarkFor('NVDA');
const at = iso => Date.parse(iso);

test('the reaction is the first regular session that closed after the release, computed from prices only', () => {
  const r = marketReaction(fixture.NVDA, fixture.SMH, smh, '2026-08-26T20:20:00Z', at('2026-08-27T21:30:00Z'));
  assert.equal(r.session, '2026-08-27');
  assert.equal(r.previousSession, '2026-08-26');
  assert.equal(r.closeChange, 8.74);              // 227.98 / 209.66
  assert.equal(r.gap, 6.3);                       // open 222.86 vs 209.66
  assert.ok(r.rangeLow <= r.gap && r.gap <= r.rangeHigh);
  assert.equal(r.benchmark.symbol, 'SMH');
  assert.equal(r.benchmark.change, 3.1);          // 573 / 555.77
  assert.equal(r.relative, 5.64);
  assert.ok(r.volumeRatio > 1.5 && r.volumeRatio < 3, String(r.volumeRatio));
  assert.deepEqual(r.series.map(p => p.date), ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27']);
  assert.equal(r.releaseIndex, 3);
  // A day later the session after the reaction closes too: five points, the release still between the 3rd and 4th.
  const later = marketReaction(fixture.NVDA, fixture.SMH, smh, '2026-08-26T20:20:00Z', at('2026-08-28T22:00:00Z'));
  assert.equal(later.series.length, 5);
  assert.equal(later.releaseIndex, 3);
  assert.equal(later.closeChange, r.closeChange);
});

test('nothing is shown until the reaction session has closed and settled', () => {
  assert.equal(marketReaction(fixture.NVDA, fixture.SMH, smh, '2026-08-26T20:20:00Z', at('2026-08-27T18:00:00Z')), null); // 14:00 New York
  assert.equal(marketReaction(fixture.NVDA, fixture.SMH, smh, '2026-08-26T20:20:00Z', at('2026-08-27T20:30:00Z')), null); // 16:30, not settled
  assert.equal(marketReaction(fixture.NVDA, fixture.SMH, smh, 'not a date', at('2026-08-28T22:00:00Z')), null);
  assert.equal(marketReaction([], fixture.SMH, smh, '2026-08-26T20:20:00Z', at('2026-08-28T22:00:00Z')), null);
  assert.equal(marketReaction(fixture.NVDA, fixture.SMH, smh, '2026-12-01T20:20:00Z', at('2026-12-03T22:00:00Z')), null); // no bar after it
});

test('a release before the open or during the session reacts the same day', () => {
  assert.equal(marketReaction(fixture.NVDA, fixture.SMH, smh, '2026-08-27T11:00:00Z', at('2026-08-28T00:00:00Z')).session, '2026-08-27');
  assert.equal(marketReaction(fixture.NVDA, fixture.SMH, smh, '2026-08-26T14:00:00Z', at('2026-08-28T00:00:00Z')).session, '2026-08-26');
  // a Friday release after the close reacts on Monday
  assert.equal(marketReaction(fixture.NVDA, fixture.SMH, smh, '2026-08-28T21:00:00Z', at('2026-09-01T00:00:00Z')).session, '2026-08-31');
});

test('the benchmark is optional and follows the TP半導体40 roster', () => {
  assert.equal(benchmarkFor('NVDA').symbol, 'SMH');
  assert.equal(benchmarkFor('MU').symbol, 'SMH');
  assert.equal(benchmarkFor('MSFT').symbol, 'QQQ');
  const r = marketReaction(fixture.NVDA, null, null, '2026-08-26T20:20:00Z', at('2026-08-27T21:30:00Z'));
  assert.equal(r.benchmark, null);
  assert.equal(r.relative, null);
  assert.equal(r.closeChange, 8.74);
});

test('New York close times follow daylight saving', () => {
  assert.equal(new Date(newYorkTime('2026-08-27', 16)).toISOString(), '2026-08-27T20:00:00.000Z');
  assert.equal(new Date(newYorkTime('2026-12-01', 16)).toISOString(), '2026-12-01T21:00:00.000Z');
});

test('a served reaction is checked field by field', () => {
  const r = marketReaction(fixture.NVDA, fixture.SMH, smh, '2026-08-26T20:20:00Z', at('2026-08-28T22:00:00Z'));
  assert.deepEqual(parseMarketReaction(JSON.parse(JSON.stringify(r))), r);
  assert.equal(parseMarketReaction({ ...r, closeChange: 'x' }), null);
  assert.equal(parseMarketReaction({ ...r, releaseIndex: 0 }), null);
  assert.equal(parseMarketReaction({ ...r, series: r.series.slice(0, 1) }), null);
  assert.equal(parseMarketReaction({ ...r, benchmark: { symbol: 'EVIL', change: 1 } }), null);
  assert.equal(parseMarketReaction(null), null);
});

test('the route adds the reaction on the server from prices, after the PRO check, and the panel shows it only when present', () => {
  const route = readFileSync(new URL('../app/api/research/deep-analysis/route.ts', import.meta.url), 'utf8');
  assert.ok(route.indexOf('pro-required') < route.indexOf('withReactions('));
  const server = readFileSync(new URL('../lib/research/market-reaction-server.ts', import.meta.url), 'utf8');
  assert.match(server, /loadDailyCloses/);
  assert.doesNotMatch(server, /openai|RESEARCH_DEEP_MODEL/i);
  const panel = readFileSync(new URL('../app/research/deep-analysis-panel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /item\.reaction && <MarketReactionView/);
});
