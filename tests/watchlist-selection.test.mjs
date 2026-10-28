import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../app/research/watchlist/use-watchlist-selection.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function harness(saved = null, blocked = false) {
  const values = new Map(saved === null ? [] : [['tech-phase:watchlist-selection:v1', saved]]);
  const events = new EventTarget();
  const storage = {
    getItem: key => { if (blocked) throw Error('blocked'); return values.get(key) ?? null; },
    setItem: (key, value) => { if (blocked) throw Error('blocked'); values.set(key, value); },
  };
  let notices = 0, cleanup;
  function mount(server = false) {
    const target = { exports: {} };
    new Function('require', 'module', 'exports', 'sessionStorage', 'window', 'Event', compiled)(() => ({
      useSyncExternalStore: (subscribe, snapshot, serverSnapshot) => {
        cleanup?.(); cleanup = subscribe(() => notices++);
        return server ? serverSnapshot() : snapshot();
      },
    }), target, target.exports, storage, events, Event);
    return target.exports.useWatchlistSelection;
  }
  return { mount, values, get notices() { return notices; } };
}

test('selected list survives page remount and reload without storing account or stock data', () => {
  const h = harness(); const hook = h.mount();
  assert.equal(hook()[0], 'default');
  hook()[1]('my-list-3');
  assert.equal(hook()[0], 'my-list-3');
  assert.equal(h.mount()()[0], 'my-list-3');
  assert.equal(h.notices, 1);
  assert.deepEqual([...h.values], [['tech-phase:watchlist-selection:v1', 'my-list-3']]);
});
test('selection stays in its own tab and the server snapshot is stable', () => {
  const first = harness('my-list-4'), second = harness();
  assert.equal(first.mount()()[0], 'my-list-4');
  assert.equal(second.mount()()[0], 'default');
  assert.equal(first.mount(true)()[0], 'default');
});
test('blocked storage keeps list switching usable during navigation', () => {
  const h = harness(null, true); const hook = h.mount();
  hook()[1]('custom-list');
  assert.equal(hook()[0], 'custom-list');
  assert.equal(h.notices, 1);
  assert.equal(h.values.size, 0);
});
test('invalid stored values fall back and invalid selections are ignored', () => {
  for (const saved of ['<script>', '', 'x'.repeat(81)]) {
    const h = harness(saved), hook = h.mount();
    assert.equal(hook()[0], 'default');
    hook()[1]('invalid/list');
    assert.equal(hook()[0], 'default');
    assert.equal(h.notices, 0);
  }
});
