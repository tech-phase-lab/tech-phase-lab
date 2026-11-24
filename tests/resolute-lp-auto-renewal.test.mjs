// RESOLUTE LP gold button and automatic renewal (lawyer review, Nov 24; owner, Nov 24: one tick, one press): the one-line
// auto-renewal notice (how and by when to stop) is always shown right above the consent line, before anything goes to PayPal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

test('LP button: the auto-renewal and refund lines sit above the consent line; one tick and one press go to PayPal', async () => {
  const dir = await mkdtemp(join(process.cwd(), '.buy-renewal-')), require = createRequire(import.meta.url);
  const React = require('react'), { createRoot } = require('react-dom/client');
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'], before = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  try {
    const outfile = join(dir, 'buy.cjs');
    await build({ entryPoints: ['app/resolute/lp/buy-button.tsx'], outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' } });
    const BuyButton = require(outfile).default, approval = 'https://www.paypal.com/checkoutnow?token=ORDER12345678';
    const run = async ({ language = 'ja', autoRenewal = true, value = language === 'ja' ? '7980' : '59.00' }) => {
      const dom = new JSDOM('<div id="root"></div>', { url: 'https://site.test/resolute/lp' }), bodies = [], went = [];
      Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: dom.window });
      Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: dom.window.document });
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      globalThis.fetch = async (url, options) => {
        assert.equal(String(url), '/api/resolute/live-payments/orders');
        const body = JSON.parse(options.body); bodies.push(body);
        return Response.json({ orderId: crypto.randomUUID(), sandbox: false, state: 'created', expiresAt: '2027-03-01T00:00:00Z', approvalUrl: approval, claimRequired: false,
          ...(autoRenewal ? { autoRenewal: true } : {}), quote: { kind: 'initial', language, currency: language === 'ja' ? 'JPY' : 'USD', value, priceClass: 'launch' } });
      };
      const root = createRoot(document.getElementById('root'));
      await React.act(async () => root.render(React.createElement(BuyButton, { language, shownValue: value, className: 'cta', navigate: url => went.push(url) }, 'buy')));
      const link = document.querySelector('a[data-buy]'), box = () => document.querySelector('[data-consent] input');
      const tick = () => React.act(async () => { box().click(); });
      const press = async () => {
        await React.act(async () => { link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
        await React.act(async () => { await new Promise(r => setTimeout(r, 0)); });
      };
      return { dom, root, bodies, went, tick, press, box, notice: () => document.querySelector('[data-auto-renewal]'), React };
    };

    // One tick, one press (owner, Nov 24): the auto-renewal line and the refund line are always shown right above the
    // consent line, so even an auto-renewal order goes straight to PayPal on the first press.
    let r = await run({});
    const lines = () => [...document.querySelectorAll('[data-buy-lines] p')].map(p => p.textContent);
    assert.deepEqual(lines(), ['ログインしてご購入の場合、1年後から自動で更新されます。更新日の前日までアカウント画面から止められます',
      'お客様都合の返金はできません(二重課金・当方の不具合で使えない場合を除く)']);
    assert.equal(document.querySelector('[data-buy-lines]').nextElementSibling, r.box().closest('[data-consent]'));
    await r.tick(); await r.press();
    assert.deepEqual(r.went, [approval]); assert.equal(r.bodies.length, 1);
    assert.equal(r.notice(), null); // no second notice, no re-tick
    await r.React.act(async () => r.root.unmount());

    // English wording.
    r = await run({ language: 'en' });
    assert.equal(lines()[0], 'If you buy while signed in, it renews automatically after one year. You can stop it on your account page until the day before the renewal date.');
    await r.tick(); await r.press();
    assert.deepEqual(r.went, [approval]); assert.equal(r.bodies.length, 1);
    await r.React.act(async () => r.root.unmount());

    // Without automatic renewal: the same single press.
    r = await run({ autoRenewal: false });
    await r.tick(); await r.press();
    assert.deepEqual(r.went, [approval]); assert.equal(r.bodies.length, 1);
    await r.React.act(async () => r.root.unmount());
  } finally {
    for (const [k, d] of before) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
    await rm(dir, { recursive: true, force: true });
  }
});
