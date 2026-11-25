// Payment pack (owner, Nov 2026): RESOLUTE's gold LP button goes straight to PayPal on the 「銀行｜カード」 page,
// the first-purchase price switches by itself at 2027-03-01 00:00 JST (display and charge), and the bank-account FAQ.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { PGlite } from '@electric-sql/pglite';
import { identity, quote, verifyOrder, LAUNCH_END } from '../services/resolute-api/payments/policy.mjs';
import { createPaypal, livePaypalConfig } from '../services/resolute-api/payments/paypal.mjs';
import { paymentEngine } from '../services/resolute-api/payments/engine.mjs';
import { paymentStore } from '../services/resolute-api/payments/store.mjs';
import { RESOLUTE_LAUNCH_END, resolutePrice } from '../lib/resolute/price.ts';
import { OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID, isOwnerAccount } from '../lib/membership/entitlements.ts';
// The consent tick time every purchase request carries (lawyer review, Nov 24).
const CONSENT = '2025-01-01T00:00:00.000Z';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const merchant = 'MERCHANT1234';
const LAST = Date.parse('2027-02-28T23:59:59+09:00'), FIRST = Date.parse('2027-03-01T00:00:00+09:00');
const user = () => ({ id: 'user_test', primaryEmailAddressId: 'email_1', emailAddresses: [{ id: 'email_1', verification: { status: 'verified' } }], privateMetadata: {} });

test('RESOLUTE orders open PayPal on the 「銀行｜カード」 page (landing_page GUEST_CHECKOUT), Sandbox and live', async () => {
  const configs = [{ base: 'https://api-m.sandbox.paypal.com', clientId: 'id', secret: 'secret', merchantId: merchant },
    livePaypalConfig({ RESOLUTE_PAYPAL_LIVE_ENABLED: 'true', RESOLUTE_PAYPAL_LIVE_CLIENT_ID: 'id', RESOLUTE_PAYPAL_LIVE_CLIENT_SECRET: 'secret',
      RESOLUTE_PAYPAL_LIVE_MERCHANT_ID: merchant, RESOLUTE_PAYPAL_LIVE_WEBHOOK_ID: 'WH', RESOLUTE_LIVE_SITE_ORIGIN: 'https://shop.example.org' })];
  for (const config of configs) {
    const calls = [];
    const api = createPaypal(config, async (url, options) => { calls.push(options); return Response.json(url.endsWith('/token') ? { access_token: 'token', expires_in: 300 } : { id: 'PAYPAL123456' }); });
    for (const guest of [false, true]) {
      await api.create({ id: randomUUID(), ...(guest ? { guest_id: 'guest_x' } : {}), quote: { currency: 'JPY', value: '7980', language: 'ja', kind: 'initial', sku: 'resolute_v1:initial' } });
      const context = JSON.parse(calls.at(-1).body).payment_source.paypal.experience_context;
      assert.equal(context.landing_page, 'GUEST_CHECKOUT');
      assert.equal(context.user_action, 'CONTINUE'); // The return page still asks for the final 「利用規約に同意して申し込む」.
    }
  }
});

test('PRO subscriptions are unchanged: v1 billing has no landing_page (recorded in the PR), the request keeps SUBSCRIBE_NOW', () => {
  const pro = read('../services/tech-phase-billing/paypal.mjs');
  assert.match(pro, /user_action: 'SUBSCRIBE_NOW'/);
  const context = pro.match(/application_context: \{[^}]*\}/)[0];
  assert.ok(!context.includes('landing_page'));
  assert.match(pro, /v1 Subscriptions application_context has only/);
});

test('price switch boundary: 2027-02-28 23:59:59 JST is the launch price, 03-01 00:00 JST the standard one (display and charge)', () => {
  assert.equal(RESOLUTE_LAUNCH_END, LAUNCH_END);
  assert.equal(FIRST, LAUNCH_END);
  assert.deepEqual(resolutePrice('ja', LAST), { launch: true, value: '7980' });
  assert.deepEqual(resolutePrice('ja', FIRST), { launch: false, value: '9800' });
  assert.deepEqual(resolutePrice('en', LAST), { launch: true, value: '59.00' });
  assert.deepEqual(resolutePrice('en', FIRST), { launch: false, value: '69.00' });
  const m = identity(user(), LAST);
  for (const [lang, before, after] of [['ja', '7980', '9800'], ['en', '59.00', '69.00']]) {
    assert.equal(quote('initial', lang, m, { use: false }, LAST).value, before);
    assert.equal(quote('initial', lang, m, { use: false }, FIRST).value, after);
    // Fixed when the order was created: re-checking at capture after the switch keeps the created price.
    assert.equal(quote('initial', lang, m, { use: false }, FIRST + 60000, LAST).value, before);
    assert.equal(quote('initial', lang, m, { use: false }, FIRST + 60000, FIRST).value, after);
  }
  assert.throws(() => quote('initial', 'ja', m, { use: false }, LAST, FIRST), /INVALID_PAYMENT_INPUT/);
});

test('display after the switch: no launch line, no strike-through, only ¥9,800 / $69', async () => {
  const dir = await mkdtemp(join(process.cwd(), '.lp-price-')), require = createRequire(import.meta.url);
  const realNow = Date.now;
  try {
    const { createElement } = require('react'), { renderToStaticMarkup } = require('react-dom/server');
    const pages = {};
    for (const [name, entry] of [['ja', 'app/resolute/lp/landing.tsx'], ['en', 'app/resolute/lp/landing-en.tsx']]) {
      const outfile = join(dir, `${name}.cjs`);
      await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'react-dom', 'next/*'], loader: { '.css': 'empty', '.woff2': 'empty' } });
      pages[name] = require(outfile).default;
    }
    const render = (name, at) => { Date.now = () => at; try { return renderToStaticMarkup(createElement(pages[name], { embedded: true })); } finally { Date.now = realNow; } };
    const jaBefore = render('ja', LAST), jaAfter = render('ja', FIRST), enBefore = render('en', LAST), enAfter = render('en', FIRST);
    assert.ok(jaBefore.includes('発売記念価格 ・ 2027年2月末まで') && jaBefore.includes('<del>¥9,800</del><b>¥7,980</b>'));
    assert.ok(!jaAfter.includes('発売記念価格') && !jaAfter.includes('<del>') && !jaAfter.includes('7,980'));
    assert.equal(jaAfter.match(/<b>¥9,800<\/b>/g).length, 2);
    assert.ok(enBefore.includes('Launch price · Through Feb 28, 2027') && enBefore.includes('<del>$69</del><b>$59</b>'));
    assert.ok(!enAfter.includes('Launch price') && !enAfter.includes('<del>') && !enAfter.includes('$59'));
    assert.equal(enAfter.match(/<b>\$69<\/b>/g).length, 2);
    // Lawyer review (Nov 24): the consent tick line right above each of the three buttons replaces the terms line under them.
    assert.equal(jaBefore.match(/<label[^>]*data-consent=""[^>]*><input type="checkbox"[^>]*\/><span><a href="\/terms"[^>]*>利用規約<\/a>と<a href="\/privacy"[^>]*>プライバシーポリシー<\/a>に同意する<\/span><\/label><a href="\/resolute\/checkout/g).length, 3);
    assert.equal(enBefore.match(/<span>I agree to the <a href="\/terms\?lang=en"[^>]*>Terms of Service<\/a> and <a href="\/privacy\?lang=en"[^>]*>Privacy Policy<\/a><\/span><\/label><a href="\/resolute\/checkout/g).length, 3);
    assert.ok(!jaBefore.includes('に同意のうえお進みください') && !enBefore.includes('By continuing, you agree'));
    // Three buy buttons; the PC top menu (Nov 25) adds a link with the same words that only scrolls to the first one.
    assert.equal(jaBefore.match(/data-buy="paypal">RESOLUTEを手に入れる<\/a>/g).length, 3);
    assert.equal(enBefore.match(/data-buy="paypal">Get RESOLUTE<\/a>/g).length, 3);
    assert.equal(jaBefore.match(/<a href="#buy"[^>]*>RESOLUTEを手に入れる<\/a>/g).length, 1);
  } finally { Date.now = realNow; await rm(dir, { recursive: true, force: true }); }
  for (const page of ['../app/resolute/lp/page.tsx', '../app/resolute/lp/en/page.tsx']) assert.match(read(page), /export const dynamic = "force-dynamic";/);
});

async function fixture(start) {
  const bootstrap = new PGlite(); await bootstrap.exec('CREATE DATABASE resolute'); const data = await bootstrap.dumpDataDir(); await bootstrap.close();
  const db = new PGlite({ database: 'resolute', loadDataDir: data });
  await db.exec(read('../db/resolute/010_payments_sandbox.sql'));
  const query = (sql, args) => sql.includes('pg_advisory_xact_lock') ? Promise.resolve({ rows: [] }) : db.query(sql, args);
  const store = paymentStore({ query, connect: async () => ({ query, release() {} }) });
  let clock = start, captured = false, captureTime = null;
  const remote = (order, status) => {
    const amount = { currency_code: order.quote.currency, value: order.quote.value };
    return { id: order.paypal_id, intent: 'CAPTURE', status, purchase_units: [{ reference_id: order.id, custom_id: order.id, invoice_id: order.id,
      payee: { merchant_id: merchant }, amount, items: [{ sku: order.quote.sku, quantity: '1', unit_amount: amount }],
      payments: { captures: [{ id: 'CAPTURE12345', status: 'COMPLETED', final_capture: true, amount, create_time: new Date(captureTime ?? clock).toISOString() }] } }] };
  };
  const paypal = { approval: async () => 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL123456', create: async () => ({ id: 'PAYPAL123456' }),
    get: async () => remote(await store.findPaypal('PAYPAL123456'), captured ? 'COMPLETED' : 'APPROVED'),
    capture: async () => { captured = true; captureTime = clock; }, verify: async () => true };
  const engine = paymentEngine({ store, paypal, merchantId: merchant, getUser: async () => user(), now: () => clock });
  return { db, engine, setTime: t => { clock = t; } };
}

test('an order created 23:59:59 JST and paid after 00:00 is charged and verified at the price it was created with', async () => {
  const f = await fixture(LAST);
  try {
    const order = await f.engine.create('user_test', { kind: 'initial', language: 'ja', requestKey: randomUUID(), consentAt: CONSENT });
    assert.equal(order.quote.value, '7980'); assert.equal(order.quote.priceClass, 'launch');
    f.setTime(FIRST + 120000); // Approved in PayPal and captured two minutes after the switch, within the order's 15 minutes.
    assert.equal((await f.engine.capture('user_test',{orderId:order.orderId,consentAt:CONSENT})).state, 'paid');
    const after = await f.engine.create('user_test', { kind: 'initial', language: 'ja', requestKey: randomUUID(), consentAt: CONSENT }).catch(e => e);
    assert.match(String(after.message ?? after), /ALREADY_PURCHASED/);
  } finally { await f.db.close(); }
  const g = await fixture(FIRST);
  try {
    const order = await g.engine.create('user_test', { kind: 'initial', language: 'en', requestKey: randomUUID(), consentAt: CONSENT });
    assert.equal(order.quote.value, '69.00'); assert.equal(order.quote.priceClass, 'standard');
  } finally { await g.db.close(); }
});

test('a launch-price order created after the switch is never accepted', () => {
  const q = quote('initial', 'ja', identity(user(), LAST), { use: false }, LAST), amount = { currency_code: 'JPY', value: '7980' };
  const order = id => ({ id, paypal_id: 'PAYPAL123456', quote: q, created_at: new Date(id === 'late' ? FIRST : LAST).toISOString(),
    capture_checked_at: new Date(FIRST).toISOString(), expires_at: new Date(FIRST + 900000).toISOString() });
  const remote = id => ({ id: 'PAYPAL123456', intent: 'CAPTURE', status: 'COMPLETED', purchase_units: [{ reference_id: id, custom_id: id, invoice_id: id,
    payee: { merchant_id: merchant }, amount, items: [{ sku: q.sku, quantity: '1', unit_amount: amount }],
    payments: { captures: [{ id: 'CAPTURE12345', status: 'COMPLETED', final_capture: true, amount, create_time: new Date(FIRST + 1000).toISOString() }] } }] });
  assert.equal(verifyOrder(order('early'), remote('early'), merchant, true).captureId, 'CAPTURE12345');
  assert.throws(() => verifyOrder(order('late'), remote('late'), merchant, true), /PAYMENT_REVIEW_REQUIRED/);
});

test('LP button: creates the order on the server and goes straight to PayPal (member, guest, price changed, closed)', async () => {
  const dir = await mkdtemp(join(process.cwd(), '.buy-button-')), require = createRequire(import.meta.url);
  const React = require('react'), { createRoot } = require('react-dom/client');
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'], before = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  try {
    const outfile = join(dir, 'buy.cjs');
    await build({ entryPoints: ['app/resolute/lp/buy-button.tsx'], outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' } });
    const BuyButton = require(outfile).default, id = '12345678-1234-4234-8234-123456789abc', approval = 'https://www.paypal.com/checkoutnow?token=ORDER12345678';
    const run = async ({ signedIn, value = '7980', closed = false, language = 'ja', shown = '7980' }) => {
      const dom = new JSDOM('<div id="root"></div>', { url: 'https://site.test/resolute/lp' }), calls = [], went = [];
      Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: dom.window });
      Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: dom.window.document });
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      globalThis.fetch = async (url, options) => {
        const path = String(url).replace('/api/resolute/live-payments/', ''); calls.push(path);
        if (closed) return Response.json({ error: 'PAYMENT_DISABLED' }, { status: 503 });
        if (path === 'orders' && !signedIn) return Response.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
        if (path.endsWith('session')) return Response.json({ ready: true, sandbox: false });
        const body = JSON.parse(options.body);
        assert.equal(body.kind, 'initial'); assert.equal(body.language, language); assert.ok(Number.isFinite(Date.parse(body.consentAt))); assert.match(body.requestKey, /^[0-9a-f-]{36}$/);
        return Response.json({ orderId: id, sandbox: false, state: 'created', expiresAt: '2027-03-01T00:00:00Z', approvalUrl: approval, claimRequired: !signedIn,
          quote: { kind: 'initial', language, currency: language === 'ja' ? 'JPY' : 'USD', value, priceClass: 'launch' } });
      };
      const root = createRoot(document.getElementById('root'));
      await React.act(async () => root.render(React.createElement(BuyButton, { language, shownValue: shown, className: 'cta', navigate: url => went.push(url) }, 'RESOLUTEを手に入れる')));
      const link = document.querySelector('a[data-buy]');
      assert.equal(link.getAttribute('href'), `/resolute/checkout?lang=${language}`);
      // The consent tick first (lawyer review, Nov 24; the no-tick case is in legal-final-1124.test.mjs).
      await React.act(async () => { document.querySelector('[data-consent] input').click(); });
      await React.act(async () => { link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
      await React.act(async () => { await new Promise(r => setTimeout(r, 0)); });
      await React.act(async () => root.unmount());
      return { calls, went };
    };
    let r = await run({ signedIn: true });
    assert.deepEqual(r.calls, ['orders']); assert.deepEqual(r.went, [approval]);
    r = await run({ signedIn: false });
    assert.deepEqual(r.calls, ['orders', 'guest/session', 'guest/orders']); assert.deepEqual(r.went, [approval]);
    r = await run({ signedIn: true, language: 'en', value: '59.00', shown: '59.00' });
    assert.deepEqual(r.went, [approval]);
    // The page showed ¥7,980 but the server priced ¥9,800 (opened before the switch): show the order's amount first.
    r = await run({ signedIn: false, value: '9800' });
    assert.deepEqual(r.went, [`/resolute/checkout?lang=ja&order=${id}&guest=1`]);
    r = await run({ signedIn: true, closed: true });
    assert.deepEqual(r.went, ['/resolute/checkout?lang=ja']);
  } finally {
    for (const [k, d] of before) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
    await rm(dir, { recursive: true, force: true });
  }
});

test('checkout: no 「購入内容 初回購入/更新」 choice and no renewal explanation; guest receive/claim pages are kept', () => {
  const live = read('../app/resolute/checkout/live-screen.tsx');
  for (const gone of ['<select', 'Purchase type', 'value="renewal"', '更新の可否とPRO割引は会員情報で確認します', '年間更新のためにログイン']) assert.ok(!live.includes(gone), gone);
  for (const kept of ['価格を確認して進む', 'PayPalへ進む', '購入したRESOLUTEを受け取る', 'このアカウントで受け取る', 'PayPalから戻りました。']) assert.ok(live.includes(kept), kept);
  assert.match(read('../app/api/resolute/live-payments/[...action]/route.ts'), /RESOLUTE_GUEST_CHECKOUT_ENABLED !== "true"/);
});

test('FAQ: bank account answer on the JA RESOLUTE LP and the PRO FAQ', () => {
  const answer = 'はい、PayPalを通じて払えます。PayPalの画面で「銀行」を選んでください。初めての方は、そこで口座を登録します。';
  assert.ok(read('../app/resolute/lp/landing.tsx').includes(`<details><summary>銀行口座から払えますか?</summary><p>${answer}</p></details>`));
  const faq = read('../app/research/faq/faq.tsx');
  assert.ok(faq.includes('"銀行口座から払えますか？"') && faq.includes(`"${answer}"`));
});

test('owner accounts keep full access', () => {
  assert.equal(isOwnerAccount(OWNER_ACCOUNT_ID), true);
  assert.equal(isOwnerAccount(PRODUCTION_OWNER_ACCOUNT_ID), true);
  assert.match(read('../app/api/resolute/payments/[...action]/route.ts'), /userId !== OWNER_ACCOUNT_ID && userId !== tester/);
});
