// RESOLUTE LP gold button and automatic renewal (lawyer review, Nov 24): a member whose order renews automatically
// sees the one-line auto-renewal notice (how and by when to stop) right by the button, with the consent line,
// before anything goes to PayPal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

test('LP button: an auto-renewal order shows the stop notice and needs a fresh tick before PayPal; others go straight', async () => {
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

    // Japanese member with automatic renewal.
    let r = await run({});
    assert.equal(r.notice(), null); // not before the server says so
    await r.tick(); await r.press();
    assert.deepEqual(r.went, []); // held: not to PayPal yet
    const line = r.notice();
    assert.ok(line);
    assert.equal(line.textContent, '1年後から自動で更新。更新日の前日までアカウント画面で止められます');
    assert.equal(line.getAttribute('role'), 'status');
    // The notice sits right above the consent line, which sits right above the button.
    assert.equal(line.nextElementSibling, r.box().closest('[data-consent]'));
    assert.equal(r.box().checked, false); // ticked again after reading it
    await r.press();
    assert.deepEqual(r.went, []); assert.ok(r.dom.window.document.querySelector('[data-consent-error]'));
    await r.tick(); await r.press();
    assert.deepEqual(r.went, [approval]);
    assert.equal(r.bodies.length, 2);
    assert.notEqual(r.bodies[0].requestKey, r.bodies[1].requestKey); // a fresh order carries the later consent time
    assert.ok(Date.parse(r.bodies[1].consentAt) >= Date.parse(r.bodies[0].consentAt));
    await r.React.act(async () => r.root.unmount());

    // English wording.
    r = await run({ language: 'en' });
    await r.tick(); await r.press();
    assert.equal(r.notice().textContent, 'Renews automatically after one year. Stop it on your account page by the day before renewal.');
    await r.React.act(async () => r.root.unmount());

    // Without automatic renewal: no notice, straight to PayPal on the first press.
    r = await run({ autoRenewal: false });
    await r.tick(); await r.press();
    assert.deepEqual(r.went, [approval]); assert.equal(r.notice(), null); assert.equal(r.bodies.length, 1);
    await r.React.act(async () => r.root.unmount());
  } finally {
    for (const [k, d] of before) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
    await rm(dir, { recursive: true, force: true });
  }
});
