import test from 'node:test';
import assert from 'node:assert/strict';
import { addFavoriteToList } from '../lib/research/favorite-lists.ts';

const state = count => ({ lists: [
  { id: 'default', name: '', tickers: Array.from({ length: count }, (_, i) => `T${i}`) },
  { id: 'other', name: 'Other', tickers: ['MU'] },
], names: { MU: 'Micron' }, alerts: [{ ticker: 'MU', price: 200, currency: 'USD', direction: 'above' }] });

test('the 100th stock is saved and a 101st cannot silently change the list or names', () => {
  const original = state(99);
  const full = addFavoriteToList(original, 'default', 'AAPL', 'Apple');
  assert.equal(full.lists[0].tickers.length, 100);
  assert.equal(full.lists[0].tickers.at(-1), 'AAPL');
  assert.equal(original.lists[0].tickers.length, 99);
  assert.strictEqual(addFavoriteToList(full, 'default', 'MSFT', 'Microsoft'), full);
  assert.equal(full.names.MSFT, undefined);
  assert.strictEqual(full.alerts, original.alerts);
});

test('repeated additions retain the stock and another list can still accept stocks', () => {
  const original = state(100);
  const added = addFavoriteToList(original, 'other', 'AAPL', 'Apple');
  assert.strictEqual(addFavoriteToList(added, 'other', 'AAPL', 'Apple'), added);
  assert.deepEqual(added.lists[1].tickers, ['MU', 'AAPL']);
  assert.strictEqual(added.lists[0], original.lists[0]);
});

test('an empty displayed slot accepts its first stock without losing saved lists', () => {
  const original = state(1);
  const added = addFavoriteToList(original, 'my-list-3', 'AAPL', 'Apple');
  assert.deepEqual(added.lists[2].tickers, ['AAPL']);
  assert.strictEqual(added.lists[0], original.lists[0]);
  assert.strictEqual(addFavoriteToList(original, 'missing', 'AAPL'), original);
  assert.strictEqual(addFavoriteToList(original, 'default', 'invalid ticker'), original);
});
