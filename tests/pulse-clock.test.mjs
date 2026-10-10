import assert from 'node:assert/strict';
import test from 'node:test';
import { pulseClock } from '../lib/research/news-time.ts';

test('top strip clock shows the source time with its zone, or only the date', () => {
  assert.equal(pulseClock('2026-10-06T09:04:00Z', 'published', true), '10/6 18:04 JST');
  assert.equal(pulseClock('2026-10-06T09:04:00Z', 'published', false), '10/6 05:04 ET');
  // A date-only release shows only its date, never the time it was first seen (owner, Oct 10).
  assert.equal(pulseClock('2026-10-06', 'date', true, '2026-10-06T12:30:00Z'), '10/6');
  assert.equal(pulseClock('2026-10-06', 'date', false, '2026-10-06T12:30:00Z'), '10/6');
  // A late discovery never relabels an older release with a later day.
  assert.equal(pulseClock('2026-10-01', 'date', true, '2026-10-06T12:30:00Z'), '10/1');
  assert.equal(pulseClock('2026-10-06', 'date', true), '10/6');
});
