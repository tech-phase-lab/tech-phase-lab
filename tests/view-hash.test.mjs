import test from 'node:test';
import assert from 'node:assert/strict';

function fakeWindow(location) {
  const listeners = {};
  return {
    location,
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    emit: (type, event = {}) => (listeners[type] ?? []).forEach(fn => fn({ type, ...event })),
  };
}

test('a hash chosen by a tap wins over an address bar that Next.js put back (owner, Oct 16)', async () => {
  const window = fakeWindow({ pathname: '/research', hash: '' });
  globalThis.window = window;
  const { effectiveHash, rememberHash, resetRememberedHash } = await import('../lib/research/view-hash.ts');
  resetRememberedHash();
  assert.equal(effectiveHash(), '');
  rememberHash('#monitored-companies');
  window.location.hash = '#research-main'; // the router rewrote the address bar
  assert.equal(effectiveHash(), '#monitored-companies');
  // Our own synthetic hashchange carries no URL and keeps the choice.
  window.emit('hashchange', { newURL: '' });
  assert.equal(effectiveHash(), '#monitored-companies');
  // Real navigation (back/forward, a typed hash) hands control back to the address bar.
  window.emit('popstate');
  assert.equal(effectiveHash(), '#research-main');
  rememberHash('#saved');
  window.emit('hashchange', { newURL: 'https://example.test/research#metrics' });
  window.location.hash = '#metrics';
  assert.equal(effectiveHash(), '#metrics');
  // A choice never carries over to another page.
  rememberHash('#saved');
  window.location.pathname = '/research/news';
  window.location.hash = '';
  assert.equal(effectiveHash(), '');
  // ...and coming back to the home page later does not bring the old choice back.
  window.location.pathname = '/research';
  window.location.hash = '#research-main';
  assert.equal(effectiveHash(), '#research-main');
  delete globalThis.window;
});
