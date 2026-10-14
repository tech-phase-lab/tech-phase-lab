import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSavedIds, orderSavedEvents } from '../lib/research/saved-collection.ts';

test('legacy saves retain append order without migrating or inventing dates', () => {
  const ids = parseSavedIds('["new-article","old-article","new-article",null,7]');
  const events = [{ id: 'new-article', publishedOn: '2026-10-14' }, { id: 'old-article', publishedOn: '2025-01-01' }];
  assert.deepEqual(ids, ['new-article', 'old-article']);
  assert.deepEqual(orderSavedEvents(events, ids, 'saved').map(x => x.id), ['old-article', 'new-article']);
  assert.deepEqual(orderSavedEvents(events, ids, 'published').map(x => x.id), ['new-article', 'old-article']);
  assert.equal(events[0].id, 'new-article');
});
test('invalid saves are safe and re-saving moves an article to the latest position', () => {
  for (const raw of ['bad json', '{}', 'null']) assert.deepEqual(parseSavedIds(raw), []);
  const events = [{ id: 'a', publishedOn: '2026-10-14' }, { id: 'b', publishedOn: '2026-10-14' }];
  assert.deepEqual(orderSavedEvents(events, ['b', 'a'], 'saved').map(x => x.id), ['a', 'b']);
  assert.deepEqual(orderSavedEvents(events, ['a', 'b'], 'published').map(x => x.id), ['b', 'a']);
});
