// RESOLUTE one tick, one press (owner, Nov 24): LP button → PayPal → pay → done. The order carries the consent ticked
// above the LP button; back from PayPal with the payment APPROVED, the checkout screen completes it by itself with that
// consent (no second tick, no second button). Also: the approval link comes from PayPal's create answer (no second round
// trip), its exact shape no longer fails a purchase, and a failed payment request leaves one short line in the service log.
// PayPal stand-ins only, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { paymentStore } from '../services/resolute-api/payments/store.mjs';
import { paymentEngine } from '../services/resolute-api/payments/engine.mjs';
import { paymentHttp, paymentFailureLine } from '../services/resolute-api/payments/http.mjs';
import { createPaypal } from '../services/resolute-api/payments/paypal.mjs';
import { guestIdentity } from '../services/resolute-api/payments/guest.mjs';
import { PaymentError } from '../services/resolute-api/payments/policy.mjs';
import { renewalStore } from '../services/resolute-api/payments/renewal-store.mjs';
import { PRODUCTION_OWNER_ACCOUNT_ID } from '../lib/membership/entitlements.ts';
import { liveOrder } from '../lib/resolute/live-checkout.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const MID = 'MERCHANT1234', NOW = Date.parse('2026-12-16T03:00:00Z'), CONSENT = '2026-12-16T02:59:30.000Z';
const account = id => ({ id, primaryEmailAddressId: 'e1', emailAddresses: [{ id: 'e1', emailAddress: 'buyer@example.com', verification: { status: 'verified' } }], privateMetadata: {} });

async function ledger(t) {
  const boot = new PGlite(); await boot.exec('CREATE DATABASE resolute'); const data = await boot.dumpDataDir(); await boot.close();
  const db = new PGlite({ database: 'resolute', loadDataDir: data }); t.after(() => db.close());
  for (const file of ['010_payments_sandbox.sql', '014_payments_live.sql', '021_guest_payments.sql', '025_auto_renewal.sql'])
    await db.exec(read('../db/resolute/' + file));
  const query = db.query.bind(db), pool = { query, connect: async () => ({ query, release() {} }) };
  const store = paymentStore(pool, { environment: 'live' });
  return { db, store, renewals: renewalStore(pool, store, { environment: 'live' }) };
}

/** Live PayPal stand-in with real answer shapes: PAYER_ACTION_REQUIRED + payer-action link, APPROVED after the buyer pays,
 * COMPLETED (with the saved PayPal) after capture. `link` lets a test give the payer-action link another shape. */
function livePaypal(store, clock, { link = id => `https://www.paypal.com/checkoutnow?token=${id}` } = {}) {
  const pp = { status: new Map(), calls: [], bodies: [] };
  const remote = async (id, extra = {}) => {
    const order = await store.findPaypal(id), status = pp.status.get(id), amount = { currency_code: order.quote.currency, value: order.quote.value };
    return { id, intent: 'CAPTURE', status, purchase_units: [{ reference_id: order.id, custom_id: order.id, invoice_id: order.id,
      payee: { merchant_id: MID }, amount, items: [{ sku: order.quote.sku, quantity: '1', unit_amount: amount }],
      ...(status === 'COMPLETED' ? { payments: { captures: [{ id: 'CAP' + id, status: 'COMPLETED', final_capture: true, amount, create_time: new Date(clock() + 1000).toISOString() }] } } : {}) }],
      ...(status === 'PAYER_ACTION_REQUIRED' ? { links: [{ rel: 'self', href: `https://api-m.paypal.com/v2/checkout/orders/${id}` }, { rel: 'payer-action', href: link(id) }] } : {}), ...extra };
  };
  Object.assign(pp, {
    async create(order) {
      pp.calls.push('create'); pp.bodies.push(order);
      const id = 'ORDER' + String(pp.bodies.length).padStart(6, '0');
      pp.status.set(id, 'PAYER_ACTION_REQUIRED');
      // PayPal answers create before our ledger binds the id, so build the answer by hand.
      return { id, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: link(id) }] };
    },
    approval: async id => { pp.calls.push('approval'); const r = await remote(id); return r.links ? `https://www.paypal.com/checkoutnow?token=${id}` : null; },
    get: async id => { pp.calls.push('get'); return remote(id); },
    capture: async order => { pp.calls.push('capture'); assert.equal(pp.status.get(order.paypal_id), 'APPROVED'); pp.status.set(order.paypal_id, 'COMPLETED');
      return remote(order.paypal_id, order.auto_renewal_offered ? { payment_source: { paypal: { attributes: { vault: { id: 'tok_saved1', status: 'VAULTED', customer: { id: 'cust_1' } } } } } } : {}); },
    approve: id => pp.status.set(id, 'APPROVED'),
  });
  return pp;
}

async function setup(t, options = {}) {
  const l = await ledger(t), clock = () => NOW, paypal = livePaypal(l.store, clock, options);
  const engine = paymentEngine({ store: l.store, paypal, environment: 'live', merchantId: MID, getUser: async id => account(id), now: clock,
    allowGuest: () => true, renewals: l.renewals, autoRenewal: () => true });
  return { ...l, paypal, engine };
}

test('member (auto-renewal): one press creates the order and its PayPal link with no second PayPal call; back from PayPal it completes with the LP consent', async t => {
  const s = await setup(t), user = 'user_member1';
  const created = await s.engine.create(user, { kind: 'initial', language: 'ja', requestKey: randomUUID(), consentAt: CONSENT });
  assert.equal(created.autoRenewal, true);
  assert.equal(created.approvalUrl, `https://www.paypal.com/checkoutnow?token=${created.paypalOrderId}`);
  assert.deepEqual(s.paypal.calls, ['create'], 'the approval link comes from the create answer');
  assert.ok(s.paypal.bodies[0].auto_renewal_offered, 'PayPal is asked to save the payment method');
  // Back on the checkout page before paying (or after cancelling): not approved, the PayPal link is offered again.
  let status = await s.engine.status(user, created.orderId);
  assert.equal(status.approved, undefined); assert.ok(status.approvalUrl);
  // The buyer pays in PayPal; PayPal returns to the checkout page.
  s.paypal.approve(created.paypalOrderId);
  status = await s.engine.status(user, created.orderId);
  assert.equal(status.approved, true); assert.equal(status.approvalUrl, null);
  assert.equal(liveOrder(status).approved, true);
  // The screen completes it by itself: no consent field in the request.
  assert.equal((await s.engine.capture(user, { orderId: created.orderId })).state, 'paid');
  const order = await s.store.get(created.orderId);
  assert.equal(order.quote.termsConsentAt, CONSENT);
  assert.equal(order.quote.captureConsentAt, undefined, 'no second tick was asked for');
  assert.equal(new Date(order.auto_renewal_consent_at).toISOString(), CONSENT, 'the LP tick (under the auto-renewal line) is the renewal consent');
  assert.equal((await s.renewals.view(user)).state, 'active');
  // A second completion (reload) changes nothing.
  assert.equal((await s.engine.capture(user, { orderId: created.orderId })).state, 'already-paid');
  assert.equal(s.paypal.calls.filter(c => c === 'capture').length, 1);
});

test('guest: one press, PayPal, back, completed by itself; the account claim follows', async t => {
  const s = await setup(t), guest = guestIdentity(randomBytes(32).toString('hex'));
  const created = await s.engine.create(guest, { kind: 'initial', language: 'en', requestKey: randomUUID(), consentAt: CONSENT });
  assert.equal(created.autoRenewal, undefined); assert.equal(created.claimRequired, true);
  assert.ok(!s.paypal.bodies[0].auto_renewal_offered, 'a guest order never asks PayPal to save the payment method');
  s.paypal.approve(created.paypalOrderId);
  assert.equal((await s.engine.status(guest, created.orderId)).approved, true);
  assert.equal((await s.engine.capture(guest, { orderId: created.orderId })).state, 'paid');
  assert.equal((await s.engine.status(guest, created.orderId)).state, 'paid');
});

test('completing still needs PayPal\'s approval and a consent kept with the order; a fresh tick time is still accepted', async t => {
  const s = await setup(t), user = 'user_member2';
  const created = await s.engine.create(user, { kind: 'initial', language: 'ja', requestKey: randomUUID(), consentAt: CONSENT });
  await assert.rejects(s.engine.capture(user, { orderId: created.orderId }), e => e instanceof PaymentError && e.code === 'PAYMENT_NOT_APPROVED');
  for (const bad of [{ orderId: created.orderId, consentAt: 'yesterday' }, { orderId: created.orderId, extra: 1 }, null])
    await assert.rejects(s.engine.capture(user, bad), e => e instanceof PaymentError && ['CONSENT_REQUIRED', 'INVALID_PAYMENT_INPUT'].includes(e.code));
  s.paypal.approve(created.paypalOrderId);
  const later = new Date(NOW).toISOString();
  assert.equal((await s.engine.capture(user, { orderId: created.orderId, consentAt: later })).state, 'paid');
  assert.equal((await s.store.get(created.orderId)).quote.captureConsentAt, later);
  // An order without a stored consent time (made before the consent line existed) is never completed without one.
  const store = { get: async () => ({ id: created.orderId, user_id: user, state: 'created', quote: { kind: 'initial' } }) };
  const engine = paymentEngine({ store, paypal: s.paypal, environment: 'live', merchantId: MID, getUser: async id => account(id), now: () => NOW });
  await assert.rejects(engine.capture(user, { orderId: created.orderId }), e => e.code === 'CONSENT_REQUIRED');
});

test('owner account (production) buys the same one-press way', async t => {
  const s = await setup(t);
  const created = await s.engine.create(PRODUCTION_OWNER_ACCOUNT_ID, { kind: 'initial', language: 'ja', requestKey: randomUUID(), consentAt: CONSENT });
  assert.ok(created.approvalUrl);
  s.paypal.approve(created.paypalOrderId);
  assert.equal((await s.engine.capture(PRODUCTION_OWNER_ACCOUNT_ID, { orderId: created.orderId })).state, 'paid');
});

test('PayPal link shape (e.g. an order that saves the payment method) no longer fails the order', async t => {
  const s = await setup(t, { link: id => `https://www.paypal.com/checkoutnow?token=${id}&fundingSource=paypal&vault=true` });
  const created = await s.engine.create('user_member3', { kind: 'initial', language: 'ja', requestKey: randomUUID(), consentAt: CONSENT });
  assert.equal(created.approvalUrl, `https://www.paypal.com/checkoutnow?token=${created.paypalOrderId}`);
  assert.equal(liveOrder({ ...created, sandbox: false }).approvalUrl, created.approvalUrl);
  const bad = await setup(t, { link: id => `https://www.paypal.com.evil.test/checkoutnow?token=${id}` });
  await assert.rejects(bad.engine.create('user_member4', { kind: 'initial', language: 'ja', requestKey: randomUUID(), consentAt: CONSENT }),
    e => e.code === 'PAYPAL_UNAVAILABLE' && e.detail?.stage === 'approval-link' && e.detail.reason === 'origin');
});

test('a refused PayPal request keeps only PayPal\'s short codes, and the service log gets one line without ids or bodies', async () => {
  const config = { base: 'https://api-m.paypal.com', clientId: 'id', secret: 'secret', merchantId: MID, webhookId: 'WH', returnUrl: 'https://techphase.app/resolute/checkout' };
  const api = createPaypal(config, async url => String(url).endsWith('/token') ? Response.json({ access_token: 'token', expires_in: 300 })
    : Response.json({ name: 'UNPROCESSABLE_ENTITY', message: 'payer buyer@example.com secret', debug_id: 'f00dbabe12345', details: [{ issue: 'PAYEE_NOT_ENABLED_FOR_VAULT', description: 'x' }] }, { status: 422 }));
  const order = { id: randomUUID(), auto_renewal_offered: true, quote: { kind: 'initial', currency: 'JPY', value: '7980', language: 'ja', sku: 'resolute_v1:initial' } };
  let error; try { await api.create(order); } catch (e) { error = e; }
  assert.equal(error.code, 'PAYPAL_UNAVAILABLE'); assert.equal(error.status, 503);
  assert.deepEqual(error.detail, { stage: 'POST /v2/checkout/orders', status: 422, name: 'UNPROCESSABLE_ENTITY', issue: 'PAYEE_NOT_ENABLED_FOR_VAULT', debugId: 'f00dbabe12345' });
  const line = paymentFailureLine('live', 'POST', `/internal/v1/live-payments/orders/${order.id}`, error);
  assert.deepEqual(line, { event: 'RESOLUTE_PAYMENT_ERROR', environment: 'live', method: 'POST', route: 'live-payments/orders/:id', code: 'PAYPAL_UNAVAILABLE', status: 503,
    paypal: error.detail });
  assert.doesNotMatch(JSON.stringify(line), /buyer@example\.com|secret|token/);
  // Clerk / Postgres failures: their short codes only.
  const clerk = Object.assign(new Error('user_123 not found'), { status: 404, errors: [{ code: 'resource_not_found', message: 'user_123' }] });
  assert.deepEqual(paymentFailureLine('live', 'POST', '/internal/v1/live-payments/orders', clerk),
    { event: 'RESOLUTE_PAYMENT_ERROR', environment: 'live', method: 'POST', route: 'live-payments/orders', code: 'PAYMENT_UNAVAILABLE', status: 503,
      error: 'Error', pg: undefined, clerk: 'resource_not_found', httpStatus: 404 });
  assert.equal(paymentFailureLine('live', 'POST', '/x', Object.assign(new Error('column "x" does not exist'), { code: '42703' })).pg, '42703');
  // A network failure says so, without the error text.
  const down = createPaypal(config, async () => { throw new TypeError('fetch failed https://secret.example'); });
  await assert.rejects(down.get('ORDER123456'), e => e.code === 'PAYPAL_UNAVAILABLE' && e.detail.reason === 'network' && e.detail.stage === 'GET /v2/checkout/orders/:id');
});

test('the HTTP layer writes the failure line and still answers with the code only', async () => {
  const lines = [], original = console.error;
  console.error = line => lines.push(line);
  try {
    const engine = { create: async () => { const e = new PaymentError('PAYPAL_UNAVAILABLE', 503); e.detail = { stage: 'GET /v2/checkout/orders/:id', status: 500 }; throw e; } };
    const http = paymentHttp({ engine, store: { flag: async () => {} }, authenticate: async () => 'user_member9', enabled: true, allowedUsers: null, environment: 'live' });
    const res = await http(new Request('https://api.test/internal/v1/live-payments/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
    assert.equal(res.status, 503); assert.deepEqual(await res.json(), { error: 'PAYPAL_UNAVAILABLE' });
  } finally { console.error = original; }
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), { event: 'RESOLUTE_PAYMENT_ERROR', environment: 'live', method: 'POST', route: 'live-payments/orders', code: 'PAYPAL_UNAVAILABLE', status: 503,
    paypal: { stage: 'GET /v2/checkout/orders/:id', status: 500 } });
});

test('checkout screen: an order not approved yet is never completed by itself; 「PayPalへ進む」 has its own tick', async () => {
  const { build } = await import('esbuild'), { mkdtemp, rm } = await import('node:fs/promises'), { createRequire } = await import('node:module'), { join } = await import('node:path');
  const { JSDOM } = await import('jsdom');
  const dir = await mkdtemp(join(process.cwd(), '.one-press-screen-')), require = createRequire(import.meta.url);
  const React = require('react'), { createRoot } = require('react-dom/client');
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://site.test/resolute/checkout?lang=ja&order=12345678-1234-4234-8234-123456789abc' });
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'], before = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  let root;
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: dom.window });
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: dom.window.document });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const outfile = join(dir, 'screen.cjs');
    await build({ entryPoints: ['app/resolute/checkout/live-screen.tsx'], outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' } });
    const Screen = require(outfile).default, id = '12345678-1234-4234-8234-123456789abc', calls = [], went = [];
    let approved = false;
    const approval = 'https://www.paypal.com/checkoutnow?token=ORDER12345678';
    globalThis.fetch = async url => { calls.push(String(url)); return Response.json({ orderId: id, sandbox: false, state: 'created', expiresAt: '2027-03-01T00:00:00Z', claimRequired: false,
      ...(approved ? { approved: true, approvalUrl: null } : { approvalUrl: approval }), quote: { kind: 'initial', language: 'ja', currency: 'JPY', value: '9800', priceClass: 'standard' } }); };
    root = createRoot(document.getElementById('root'));
    const render = async props => { await React.act(async () => root.render(React.createElement(Screen, { orderId: id, language: 'ja', cancelled: false, salesEnabled: true, navigate: url => went.push(url), ...props })));
      await React.act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
    await render({ key: 'a' });
    assert.match(document.body.textContent, /9,800/);
    const link = [...document.querySelectorAll('a')].find(a => a.textContent === 'PayPalへ進む');
    assert.ok(link); assert.equal(link.previousElementSibling, document.querySelector('[data-consent]'));
    await React.act(async () => { link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
    assert.deepEqual(went, []); assert.ok(document.querySelector('[data-consent-error]'));
    await React.act(async () => { document.querySelector('[data-consent] input').click(); });
    await React.act(async () => { link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
    assert.deepEqual(went, [approval]);
    assert.ok(!calls.some(c => c.endsWith('/capture')));
    // Came back through PayPal's cancel link: even an approved order is not completed by itself.
    approved = true;
    await render({ key: 'b', cancelled: true });
    assert.ok(!calls.some(c => c.endsWith('/capture')));
    // Sales closed: nothing is completed either.
    await render({ key: 'c', salesEnabled: false });
    assert.ok(!calls.some(c => c.endsWith('/capture')));
  } finally {
    if (root) await React.act(async () => root.unmount()); dom.window.close();
    for (const [k, d] of before) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
    await rm(dir, { recursive: true, force: true });
  }
});

test('an order stays payable for 60 minutes: time to sign up to PayPal and register a bank account', async t => {
  const s = await setup(t);
  const created = await s.engine.create('user_member5', { kind: 'initial', language: 'ja', requestKey: randomUUID(), consentAt: CONSENT });
  assert.equal(Date.parse(created.expiresAt) - NOW, 60 * 60000);
});

test('PayPal refuses to save the payment method: the member still buys in one press, without automatic renewal', async t => {
  const s = await setup(t), user = 'user_member6', create = s.paypal.create, lines = [], original = console.error;
  s.paypal.create = async order => {
    if (order.auto_renewal_offered) { const e = new PaymentError('PAYPAL_UNAVAILABLE', 503); e.detail = { stage: 'POST /v2/checkout/orders', status: 422, name: 'UNPROCESSABLE_ENTITY', issue: 'PAYEE_NOT_ENABLED_FOR_VAULT' }; throw e; }
    return create(order);
  };
  console.error = line => lines.push(line);
  let created;
  try { created = await s.engine.create(user, { kind: 'initial', language: 'ja', requestKey: randomUUID(), consentAt: CONSENT }); }
  finally { console.error = original; }
  assert.equal(created.autoRenewal, undefined); assert.ok(created.approvalUrl);
  assert.equal((await s.store.get(created.orderId)).auto_renewal_offered, false);
  assert.deepEqual(JSON.parse(lines[0]), { event: 'RESOLUTE_AUTO_RENEWAL_FALLBACK', paypal: { stage: 'POST /v2/checkout/orders', status: 422, name: 'UNPROCESSABLE_ENTITY', issue: 'PAYEE_NOT_ENABLED_FOR_VAULT' } });
  assert.ok((await s.store.auditList()).some(a => a.code === 'AUTO_RENEWAL_REFUSED_BY_PAYPAL'));
  s.paypal.approve(created.paypalOrderId);
  assert.equal((await s.engine.capture(user, { orderId: created.orderId })).state, 'paid');
  assert.notEqual((await s.renewals.view(user)).state, 'active');
  // Other failures (PayPal down, auth) are not retried without saving.
  const t2 = await setup(t);
  t2.paypal.create = async () => { const e = new PaymentError('PAYPAL_UNAVAILABLE', 503); e.detail = { stage: 'POST /v2/checkout/orders', status: 500 }; throw e; };
  console.error = () => {};
  try { await assert.rejects(t2.engine.create('user_member7', { kind: 'initial', language: 'ja', requestKey: randomUUID(), consentAt: CONSENT }), e => e.code === 'PAYPAL_UNAVAILABLE'); }
  finally { console.error = original; }
});

test('the saving request and the plain request use different PayPal-Request-Ids', async () => {
  const calls = [], config = { base: 'https://api-m.paypal.com', clientId: 'id', secret: 'secret', merchantId: MID, webhookId: 'WH', returnUrl: 'https://techphase.app/resolute/checkout' };
  const api = createPaypal(config, async (url, options) => { calls.push(options); return String(url).endsWith('/token') ? Response.json({ access_token: 'token', expires_in: 300 }) : Response.json({ id: 'ORDER123456' }); });
  const order = { id: randomUUID(), quote: { kind: 'initial', currency: 'JPY', value: '7980', language: 'ja', sku: 'resolute_v1:initial' } };
  await api.create({ ...order, auto_renewal_offered: true }); await api.create({ ...order, auto_renewal_offered: false });
  const [vault, plain] = calls.filter(c => c.headers['PayPal-Request-Id']);
  assert.equal(vault.headers['PayPal-Request-Id'], `${order.id}:vault`); assert.ok(JSON.parse(vault.body).payment_source.paypal.attributes.vault);
  assert.equal(plain.headers['PayPal-Request-Id'], order.id); assert.equal(JSON.parse(plain.body).payment_source.paypal.attributes, undefined);
});
