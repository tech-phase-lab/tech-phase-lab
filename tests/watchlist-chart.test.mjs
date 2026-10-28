import test from 'node:test';
import assert from 'node:assert/strict';
import { favoriteIntradayChart } from '../lib/research/watchlist-chart.ts';
const q = { ticker:'MU', price:102, change:2, percentChange:2, currency:'USD', asOf:'2026-10-07T14:02:00Z', session:'regular', source:'twelve-data', delayed:false };
const history = [{ at:'2026-10-06T15:00:00Z', price:99 }, { at:'2026-10-07T14:00:00Z', price:101 }, { at:'2026-10-07T14:01:00Z', price:100.5 }, { at:'2026-10-07T14:02:00Z', price:102 }, { at:'2026-10-07T14:03:00Z', price:103 }];
test('intraday chart keeps real reversals and excludes other days and future points', () => {
  assert.deepEqual(favoriteIntradayChart({...q, history}), {reference:100, values:[101,100.5,102], start:history[1].at, end:history[3].at});
});
test('market date follows New York rather than UTC or the viewer timezone', () => {
  const history=[{at:'2026-10-07T23:58:00Z',price:101},{at:'2026-10-08T00:00:00Z',price:102}];
  assert.deepEqual(favoriteIntradayChart({...q,asOf:'2026-10-08T00:01:00Z',history}).values,[101,102]);
});
test('missing or invalid history and baseline do not become fabricated charts', () => {
  for (const change of [{}, {history:history.slice(0,1)}, {history:[...history].reverse()}, {history:[{at:'bad',price:1},history[1]]}, {history:[history[1],{at:history[2].at,price:NaN}]}, {history,change:null}, {history,change:102}]) {
    assert.equal(favoriteIntradayChart({...q,...change}),null);
  }
});
