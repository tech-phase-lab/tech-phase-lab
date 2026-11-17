// Nov 17 (owner): the demo price-target notice for filming is sent by the monitor from a Railway variable (PUSH_DEMO_TARGET_AT,
// docs/PUSH-DEMO-TARGET.md). The owner-only demo panel and the "demo-target" action of #647 are gone: the notifications page is the
// same for everyone, the owner included.
import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';

const root = new URL('..', import.meta.url).pathname;

function files(dir) {
  return readdirSync(join(root, dir)).flatMap(name => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? files(path) : /\.(tsx?|mjs|js)$/.test(name) ? [path] : [];
  });
}

test('no demo panel, demo notice module or demo-target action is left in the site', () => {
  assert.equal(existsSync(join(root, 'app/research/push-demo-panel.tsx')), false);
  assert.equal(existsSync(join(root, 'lib/research/push-demo-notice.ts')), false);
  for (const path of [...files('app'), ...files('lib')]) {
    const source = readFileSync(join(root, path), 'utf8');
    assert.doesNotMatch(source, /push-demo|demo-target|PushDemo|X-Push-Owner-Demo|PUSH_DEMO/i, path);
  }
  for (const path of ['app/research/notification-settings.tsx', 'app/research/notification-page-view.tsx',
    'app/api/research/notifications/route.ts']) {
    assert.doesNotMatch(readFileSync(join(root, path), 'utf8'), /demo/i, path);
  }
});
