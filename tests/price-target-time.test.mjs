import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTargetTime } from '../lib/research/price-target-time.ts';

test('Japanese publication time uses JST with seconds', () => {
  assert.match(formatTargetTime('2026-09-25T10:50:28Z', 'ja'), /9月25日 19:50 JST/);
});
test('English publication time follows New York daylight and standard time', () => {
  assert.match(formatTargetTime('2026-09-25T10:50:28Z', 'en'), /06:50 EDT/);
  assert.match(formatTargetTime('2026-12-25T10:50:28Z', 'en'), /05:50 EST/);
  assert.match(formatTargetTime('2026-11-01T05:30:28Z', 'en'), /01:30 EDT/);
  assert.match(formatTargetTime('2026-11-01T06:30:28Z', 'en'), /01:30 EST/);
});
