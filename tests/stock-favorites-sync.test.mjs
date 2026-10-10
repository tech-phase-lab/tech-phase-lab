import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { toggleFavoriteStock } from '../lib/research/favorites.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/research/use-stock-favorites.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
let state, writes;
const target = { exports: {} };
new Function('require', 'module', 'exports', compiled)(id => {
  if (id === '@/lib/research/favorites') return { toggleFavoriteStock };
  if (id === './watchlist/use-favorite-lists') return { useFavoriteLists: () => ({ ...state, update: change => {
    writes++;
    state = { ...state, ...change(state) };
    return true;
  } }) };
  return require(id);
}, target, target.exports);
const readFavorites = target.exports.useStockFavorites;
function reset(overrides = {}) {
  writes = 0;
  state = { ready: true, editable: true, error: false, status: 'synced',
    lists: [{ id: 'default', name: '保有株', tickers: ['MRVL'] }, { id: 'my-list-2', name: '同期確認', tickers: ['AAPL'] }],
    names: { AAPL: 'Apple Inc.' }, alerts: [{ ticker: 'AAPL', price: 220, direction: 'above', currency: 'USD' }], ...overrides };
}
test('stock stars read the cloud primary list and edit only that list', () => {
  reset();
  const other = state.lists[1], alerts = state.alerts, names = state.names;
  assert.deepEqual(readFavorites().favorites, ['MRVL']);
  assert.equal(readFavorites().toggle('TSM'), true);
  assert.deepEqual(state.lists[0].tickers, ['MRVL', 'TSM']);
  assert.equal(state.lists[0].name, '保有株');
  assert.equal(state.lists[1], other);
  assert.equal(state.alerts, alerts);
  assert.equal(state.names, names);
  assert.equal(readFavorites().toggle('MRVL'), true);
  assert.deepEqual(state.lists[0].tickers, ['TSM']);
});
test('a star edit uses the latest sync document rather than its render snapshot', () => {
  reset(); const old = readFavorites();
  state.lists = [{ ...state.lists[0], tickers: ['MRVL', 'ANET'] }, state.lists[1]];
  old.toggle('TSM');
  assert.deepEqual(state.lists[0].tickers, ['MRVL', 'ANET', 'TSM']);
});
test('unknown accounts and conflicts cannot write through stock-page stars', () => {
  for (const override of [{ ready: false, editable: false, status: 'loading' }, { editable: false, status: 'conflict' }]) {
    reset(override); const hook = readFavorites();
    assert.equal(hook.editable, false);
    assert.equal(hook.toggle('TSM'), false);
    assert.equal(writes, 0);
    if (!state.ready) assert.deepEqual(hook.favorites, []);
  }
});
test('guest stars use the same update path without changing other lists', () => {
  reset({ status: 'guest' });
  assert.equal(readFavorites().toggle('AAPL'), true);
  assert.deepEqual(state.lists[0].tickers, ['MRVL', 'AAPL']);
  assert.deepEqual(state.lists[1].tickers, ['AAPL']);
  assert.equal(readFavorites().toggle('bad ticker'), false);
  assert.equal(writes, 1);
});
