import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join, normalize} from 'node:path';

// Nov 18, 2026: resolute-api failed to start because lib/resolute imported lib/legal, which its image did not copy.
// Every file under lib/resolute imported by an image that copies lib/resolute/*.ts must be copied into that image too.
const outside = new Set();
for (const name of readdirSync('lib/resolute').filter(f => f.endsWith('.ts'))) {
  for (const m of readFileSync(join('lib/resolute', name), 'utf8').matchAll(/from\s+['"](\.\.\/[^'"]+)['"]/g)) {
    outside.add(normalize(join('lib/resolute', m[1].endsWith('.ts') ? m[1] : m[1] + '.ts')));
  }
}
for (const file of ['services/resolute-api/Dockerfile', 'services/resolute-notifications/Dockerfile', 'services/resolute-auto-renewal/Dockerfile']) {
  test(`${file} copies every module lib/resolute imports`, () => {
    const sources = [...readFileSync(file, 'utf8').matchAll(/^COPY\s+(.+)\s+\S+$/gm)].flatMap(m => m[1].split(/\s+/));
    for (const path of outside) {
      assert.ok(sources.some(src => src === path || (src.endsWith('/') && path.startsWith(src))), `${file} is missing ${path}`);
    }
  });
}
