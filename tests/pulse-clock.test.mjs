import assert from 'node:assert/strict';
import test from 'node:test';
import { pulseClock } from '../lib/research/news-time.ts';

test('top strip clock always shows a time with its zone', () => {
  assert.equal(pulseClock('2026-10-06T09:04:00Z', 'published', true), '10/6 18:04 JST');
  assert.equal(pulseClock('2026-10-06T09:04:00Z', 'published', false), '10/6 05:04 ET');
  // A date-only release uses the time it was first seen, when that is the same or next day.
  assert.equal(pulseClock('2026-10-06', 'date', true, '2026-10-06T12:30:00Z'), '10/6 21:30 JST');
  assert.equal(pulseClock('2026-10-06', 'date', false, '2026-10-06T12:30:00Z'), '10/6 08:30 ET');
  // A late discovery never relabels an older release with a later day.
  assert.equal(pulseClock('2026-10-01', 'date', true, '2026-10-06T12:30:00Z'), '10/1');
  assert.equal(pulseClock('2026-10-06', 'date', true), '10/6');
});
