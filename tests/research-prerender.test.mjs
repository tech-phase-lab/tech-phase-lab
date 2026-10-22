import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../app/research/', import.meta.url).pathname;
async function pages(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await pages(path));
    else if (entry.name === 'page.tsx') found.push(path);
  }
  return found;
}

test('only the research home is prerendered (refreshed every minute); other server pages stay per-request (owner, Oct 22)', async () => {
  const layout = await readFile(join(root, 'layout.tsx'), 'utf8');
  assert.doesNotMatch(layout, /export const dynamic/);
  const home = await readFile(join(root, 'page.tsx'), 'utf8');
  assert.match(home, /export const revalidate = 60;/);
  assert.doesNotMatch(home, /force-dynamic/);
  // A rejected live record or an unreachable monitor must never fail the prerender.
  assert.match(home, /loadLiveHomeNews\(\)\.catch\(\(\) => null\)/);
  assert.doesNotMatch(home, /throw new Error/);
  for (const path of await pages(root)) {
    if (path === join(root, 'page.tsx')) continue;
    const source = await readFile(path, 'utf8');
    if (/^\s*["']use client["']/.test(source)) continue; // fully client-driven: prerendered shell, data loaded in the browser
    assert.match(source, /export const dynamic = "force-dynamic"/, path);
  }
});
