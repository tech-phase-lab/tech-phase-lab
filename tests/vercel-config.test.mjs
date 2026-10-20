import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Claude working branches do not build Vercel previews (CI on GitHub already tests them)', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.git.deploymentEnabled['claude/*'], false);
  // Nothing else is configured here: staging and production deployments follow the dashboard settings.
  assert.deepEqual(Object.keys(config), ['git']);
});
