import test from 'node:test';
import assert from 'node:assert/strict';
import recovery from '../scripts/research/mu_fq4_recovery.json' with { type: 'json' };
import { muLatest, muFlash } from '../lib/research/mu-latest.ts';
import { availableNewsPayload } from '../lib/research/general-news.ts';
import { deduplicateResearchEvents } from '../lib/research/deduplicate-events.ts';

test('reviewed MU recovery preserves SEC facts, fiscal identity and bilingual public feed', () => {
  // Replays the existing reviewed SEC-derived artifact, not a new measurement
  // of the original release or a claim that a model translation was exercised.
  assert.equal(recovery.facts.period, 'FQ4 2026');
  assert.equal(recovery.facts.revenueMillionUSD, 54229);
  assert.equal(recovery.facts.adjustedEPS, 33.42);
  assert.deepEqual(recovery.facts.revenueGuidanceBillionUSD, { midpoint: 61.5, range: 1.5 });
  const updates = availableNewsPayload({ ok: true, enabled: false, items: [], officialUpdates: [muFlash] }).officialUpdates;
  assert.equal(updates.length, 1);
  assert.equal(updates[0].researchId, 'mu-q4-2026');
  assert.match(updates[0].title, /\$54\.229B/);
  assert.match(updates[0].translationJa, /542\.29億ドル/);
  assert.match(updates[0].title, /33\.42/);
  assert.match(updates[0].translationJa, /33\.42/);
  assert.equal(updates[0].url, recovery.evidenceUrl);
  const [event] = deduplicateResearchEvents([muLatest, { ...muLatest, id: 'same-reviewed-release' }]);
  assert.equal(event.sources.length, 1);
  assert.equal(event.facts.length, muLatest.facts.length);
  assert.equal(event.metrics.find(metric => metric.name === 'revenue').value, 54229);
  assert.equal(event.metrics.find(metric => metric.name === 'adjusted-eps').value, 33.42);
});
