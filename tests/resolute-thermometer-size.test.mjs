import test from 'node:test';
import assert from 'node:assert/strict';
import { collectThermometer, THERMOMETER_ROSTERS } from '../lib/resolute/thermometer-provider.ts';
import { safeThermometerSnapshot, safeShockStocks, safeShockIntraday } from '../lib/resolute/thermometer-runtime.ts';

// The site reads the served thermometer snapshot with a 16,384-byte limit (lib/resolute/thermometer-transport.ts) and drops the
// whole reading above it. With #875's trail and #876's history / drops it is near 11 KB, so the Shock Gauge additions (the
// percentile thermometer, intraday extremes, the stocks' own moves) must not grow it: a realistic full snapshot stays at 14 KB
// or less, and the stored-only Shock Gauge data never reaches the site.
const asOf = '2026-11-25';
function prng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
const dates = [];
for (let t = Date.parse('2006-11-01T00:00:00Z'); t <= Date.parse(asOf + 'T00:00:00Z'); t += 86400000) { const d = new Date(t); if (![0, 6].includes(d.getUTCDay())) dates.push(d.toISOString().slice(0, 10)); }
const cache = new Map();
// A random walk per stock with a 2008-like crash, a 2020-like crash, a 2022 bear market and the last session's −4.6% intraday fall.
function bars(ticker) {
  if (cache.has(ticker)) return cache.get(ticker);
  const rand = prng([...ticker].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)); let close = 50 + rand() * 100; const out = [];
  dates.forEach((date, i) => {
    const drift = date >= '2008-09-01' && date <= '2009-03-01' ? -0.006 : date >= '2020-02-20' && date <= '2020-03-20' ? -0.015 : date >= '2022-01-01' && date <= '2022-10-15' ? -0.002 : 0.0005;
    close *= 1 + drift + (rand() - 0.5) * 0.04;
    const last = i === dates.length - 1, low = last ? close * 0.95 : close * (1 - rand() * 0.02), high = close * (1 + rand() * 0.02);
    out.push({ datetime: date, close: close.toFixed(4), high: high.toFixed(4), low: low.toFixed(4) });
  });
  const values = out.slice(-5000).reverse();
  cache.set(ticker, values); return values;
}
const fetcher = async url => Response.json(Object.fromEntries(url.searchParams.get('symbol').split(',').map(t => [t, { status: 'ok', values: bars(t) }])));
const bytes = v => new TextEncoder().encode(JSON.stringify(v)).length;

test('a realistic full thermometer snapshot stays at 14 KB or less as served; the Shock Gauge data is stored only and kept small', async () => {
  const collected = await collectThermometer({ enabled: true, apiKey: 'synthetic', rosters: THERMOMETER_ROSTERS }, asOf, fetcher);
  assert.equal(collected.nas100.status, 'ready'); assert.equal(collected.sox.status, 'ready');
  // What resolute-api serves (readThermometer): the sanitized snapshot plus validUntil.
  const served = { ...safeThermometerSnapshot(collected, asOf), validUntil: Date.parse('2026-11-26T21:00:00Z') };
  assert.ok(served.trail && served.shock, 'a full snapshot: trail and the Shock Gauge map are present');
  assert.ok(bytes(served) <= 14 * 1024, `served snapshot ${bytes(served)} bytes`);
  assert.ok(!('shockStocks' in served) && !('shockIntraday' in served), 'stored-only data is never served');
  // The percentile thermometer stores its reading only (score, band, percentiles), never the history series.
  for (const id of ['nas100', 'sox']) assert.ok(bytes(served[id]) < 400, `${id} reading ${bytes(served[id])} bytes`);
  // Stored only: the intraday extremes are a few numbers per basket and session, the stocks' moves two decimals each.
  const intraday = safeShockIntraday(collected.shockIntraday, asOf), stocks = safeShockStocks(collected.shockStocks, asOf);
  assert.ok(Object.keys(intraday).length <= 5 && bytes(intraday[asOf]) < 400, `intraday ${bytes(intraday[asOf])} bytes per session`);
  assert.ok(Object.values(intraday[asOf]).every(r => Object.keys(r).length === 6));
  assert.ok(Object.values(stocks[asOf]).every(m => [m.changePercent, m.typicalPercent, m.intradayPercent].every(v => v === undefined || Math.round(v * 100) / 100 === v)));
  assert.ok(intraday[asOf].nas100.changePercent < -3, 'the last session\'s intraday fall is measured');
});
