import test from 'node:test';
import assert from 'node:assert/strict';
import { createWatchTracker } from '../lib/research/watch-new-items.ts';
const row = (id, n) => ({ id, at: new Date(n * 1000).toISOString() });
test('initial history stays closed; genuinely new rows alert once, including tied timestamps', () => {
  const check = createWatchTracker(0);
  assert.deepEqual(check([row('a',10)]), []);
  assert.deepEqual(check([row('a',10),row('b',11),row('c',11)]).map(x=>x.id), ['b','c']);
  assert.deepEqual(check([row('c',11)]), []);
  assert.deepEqual(check([row('a',10),row('c',11),row('d',11)]).map(x=>x.id), ['d']);
});
test('older backfills and invalid times cannot reopen the panel', () => {
  const check=createWatchTracker(0); check([row('a',20)]);
  assert.deepEqual(check([row('old',10),{id:'bad',at:'invalid'}]),[]);
  assert.deepEqual(check([row('new',21)]).map(x=>x.id),['new']);
});
test('successful empty baseline can detect the next new publication', () => {
  const check=createWatchTracker(0); assert.deepEqual(check([]),[]);
  assert.deepEqual(check([row('new',1)]).map(x=>x.id),['new']);
});

test('empty baseline does not turn historical backfill into a live alert', () => {
  const check=createWatchTracker(20_000); check([]);
  assert.deepEqual(check([row('old',10)]),[]);
  assert.deepEqual(check([row('new',21)]).map(x=>x.id),['new']);
});
