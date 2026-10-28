import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/research/watchlist/use-favorite-lists.ts', import.meta.url), 'utf8');

test('the watchlist renews the identity session before asking the server and retries once after a 401', () => {
  assert.match(source, /import \{ useIdentityRefresh \} from "\.\.\/identity-provider";/);
  // The latest refresher is read through a ref: the sync controller outlives the first render.
  assert.match(source, /identity\.current = refreshIdentity/);
  assert.match(source, /await identity\.current\(\);/);
  assert.match(source, /first\.status !== 401\) return first;/);
  assert.match(source, /await identity\.current\(true\)/);
  assert.match(source, /return request\(init\);/);
});
