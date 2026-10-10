import test from 'node:test';
import assert from 'node:assert/strict';
import { quarantineSnapshot, snapshotIssues } from '../lib/research/intake.ts';

const generatedAt = '2026-10-05T12:00:00Z';
const good = { url: 'https://nvidianews.nvidia.com/news/example-release', ticker: 'NVDA', status: 'pending',
  discovered_at: '2026-10-05T11:00:00Z', checked_at: null, sha256: null, error: null };
const unsafe = { ...good, url: 'https://evil.example/news/example-release' };
const snapshot = {
  schemaVersion: 1, generatedAt, sources: [good, unsafe],
  history: [{ id: 1, url: good.url, at: generatedAt, kind: 'discovered', sha256: null },
            { id: 2, url: unsafe.url, at: generatedAt, kind: 'discovered', sha256: null }],
  discoveryRuns: [{ id: 1, ticker: 'NVDA', at: generatedAt, status: 'ok', candidates: 1, error: null, index_url: null }],
  events: [{ id: 1, url: unsafe.url, ticker: 'NVDA', detected_at: generatedAt, title: null, published_on: null }],
};

test('one invalid record no longer discards the whole live snapshot', () => {
  assert.ok(snapshotIssues(snapshot).length > 0);
  const checked = quarantineSnapshot(snapshot);
  assert.ok(checked);
  assert.deepEqual(checked.snapshot.sources.map(s => s.url), [good.url]);
  assert.deepEqual(checked.snapshot.history.map(h => h.id), [1]);
  assert.deepEqual(checked.snapshot.events, []);
  assert.equal(checked.snapshot.discoveryRuns.length, 1);
  assert.equal(checked.dropped, 3);
  assert.deepEqual(snapshotIssues(checked.snapshot), []);
});

test('a valid snapshot passes through unchanged and an invalid header still falls back', () => {
  const valid = { ...snapshot, sources: [good], history: [snapshot.history[0]], events: [] };
  assert.deepEqual(quarantineSnapshot(valid), { snapshot: valid, dropped: 0 });
  assert.equal(quarantineSnapshot({ ...valid, schemaVersion: 2 }), null);
});
