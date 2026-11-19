// RESOLUTE automatic renewal (owner request 2026-11-19): PayPal Vault on the first purchase, merchant-initiated renewal
// a year later at the renewal price of that moment (PRO member price from server records), the 7-days-before notice
// (one email 30 days before, as the terms say), stop anytime, retries without double charges. Sandbox-style mocks only, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { paymentStore } from '../services/resolute-api/payments/store.mjs';
import { paymentEngine, savedPaypal } from '../services/resolute-api/payments/engine.mjs';
import { paymentHttp } from '../services/resolute-api/payments/http.mjs';
import { createPaypal } from '../services/resolute-api/payments/paypal.mjs';
import { PaymentError } from '../services/resolute-api/payments/policy.mjs';
import { renewalStore, noticeKey } from '../services/resolute-api/payments/renewal-store.mjs';
import { renewalJob, renewalMessage, renewalDayStart, renewalDate, renewalPrice, renewalMailProvider, primaryEmail } from '../services/resolute-api/payments/renewal.mjs';
import { OWNER_ACCOUNT_ID } from '../lib/membership/entitlements.ts';
import { liveOrder } from '../lib/resolute/live-checkout.ts';
import { legalModule } from './support-legal-modules.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const MID = 'MERCHANT1234', DAY = 86400000;
const BOUGHT = Date.parse('2026-12-16T03:00:00Z'), RENEWS = Date.parse('2027-12-16T03:00:01Z') // the year starts at the capture time;
const account = (id, pro = false) => ({ id, primaryEmailAddressId: 'e1', emailAddresses: [{ id: 'e1', emailAddress: 'buyer@example.com', verification: { status: 'verified' } }],
  privateMetadata: pro ? { plan: 'pro', proExpiresAt: '2030-01-01T00:00:00Z' } : {} });

async function ledger() {
  const boot = new PGlite(); await boot.exec('CREATE DATABASE resolute'); const data = await boot.dumpDataDir(); await boot.close();
  const db = new PGlite({ database: 'resolute', loadDataDir: data });
  for (const file of ['010_payments_sandbox.sql', '014_payments_live.sql', '021_guest_payments.sql', '025_auto_renewal.sql', '025_auto_renewal.sql'])
    await db.exec(read('../db/resolute/' + file));
  const query = db.query.bind(db), pool = { query, connect: async () => ({ query, release() {} }) };
  const store = paymentStore(pool, { environment: 'live' });
  return { db, pool, store, renewals: renewalStore(pool, store, { environment: 'live' }) };
}
const remoteFor = (order, paypalId, status, capture, at) => {
  const amount = { currency_code: order.quote.currency, value: order.quote.value };
  return { id: paypalId, intent: 'CAPTURE', status, purchase_units: [{ reference_id: order.id, custom_id: order.id, invoice_id: order.id,
    payee: { merchant_id: MID }, amount, items: [{ sku: order.quote.sku, quantity: '1', unit_amount: amount }],
    ...(capture ? { payments: { captures: [{ id: 'CAP' + paypalId, status: capture, final_capture: true, amount, create_time: new Date(at).toISOString() }] } } : {}) }] };
};

/** PayPal stand-in: first purchase (create/approve/capture with a vault) and vault renewals with Request-Id idempotency. */
function fakePaypal(store, clock) {
  const pp = { vault: { id: 'tok_saved1', status: 'VAULTED', customer: { id: 'cust_1' } }, created: [], keys: new Map(), next: 'complete', charges: 0, remotes: new Map() };
  Object.assign(pp, {
    create: async order => { const id = 'ORDER' + String(pp.created.length + 1).padStart(6, '0'); pp.created.push(order); pp.remotes.set(id, 'APPROVED'); return { id }; },
    approval: async id => 'https://www.paypal.com/checkoutnow?token=' + id,
    capture: async order => { pp.remotes.set(order.paypal_id, 'COMPLETED'); return { id: order.paypal_id, status: 'COMPLETED', payment_source: { paypal: { attributes: { vault: pp.vault } } } }; },
    async get(id) {
      const saved = pp.keys.get([...pp.keys.keys()].find(k => pp.keys.get(k).id === id));
      if (saved) return saved;
      const o = await store.findPaypal(id), state = pp.remotes.get(id);
      return remoteFor(o, id, state, state === 'COMPLETED' ? 'COMPLETED' : null, clock() + 1000);
    },
    async charge(order, token) {
      assert.equal(token, pp.vault.id); assert.equal(order.quote.kind, 'renewal');
      if (pp.keys.has(order.capture_key)) return pp.keys.get(order.capture_key); // PayPal-Request-Id replay
      const mode = pp.next;
      if (mode === 'decline') throw new PaymentError('PAYPAL_DECLINED', 402);
      if (mode === 'down') throw new PaymentError('PAYPAL_UNAVAILABLE', 503);
      pp.charges++;
      const remote = remoteFor(order, 'RENEW' + String(pp.charges).padStart(6, '0'), 'COMPLETED', mode === 'pending' ? 'PENDING' : 'COMPLETED', clock() + 1000);
      pp.keys.set(order.capture_key, remote);
      if (mode === 'lost') throw new PaymentError('PAYPAL_UNAVAILABLE', 503); // charged, answer lost
      return remote;
    },
    vaultToken: async id => ({ id, customer: { id: 'cust_1' }, payment_source: { paypal: {} } }),
  });
  return pp;
}

async function buy(t, { flag = true, pro = false, user = 'user_buyer1', vault } = {}) {
  const l = await ledger(); t.after(() => l.db.close());
  let clock = BOUGHT; const now = () => clock;
  const paypal = fakePaypal(l.store, now); if (vault !== undefined) paypal.vault = vault;
  const users = new Map([[user, account(user, pro)]]);
  const getUser = async id => users.get(id) ?? account(id);
  const engine = paymentEngine({ store: l.store, paypal, environment: 'live', merchantId: MID, getUser, now, renewals: l.renewals, autoRenewal: () => flag });
  const created = await engine.create(user, { kind: 'initial', language: 'ja', requestKey: randomUUID() });
  const captured = await engine.capture(user, { orderId: created.orderId });
  const mails = [];
  const mail = { send: async (key, to, m) => { mails.push({ key, to, ...m }); return 'mail-id'; } };
  const job = () => renewalJob({ store: l.store, renewals: l.renewals, paypal, merchantId: MID, getUser, mail, now, enabled: true })();
  return { ...l, engine, paypal, users, created, captured, mails, job, user, at: v => { clock = v; } };
}

test('flag off (default): no PayPal vault request, no screen line, no plan — today\'s purchase unchanged', async t => {
  const s = await buy(t, { flag: false });
  assert.equal(s.created.autoRenewal, undefined); assert.equal(s.captured.state, 'paid');
  assert.equal(s.paypal.created[0].auto_renewal_offered, false);
  assert.deepEqual(await s.renewals.view(s.user), { available: false, enabled: false, state: null, nextRenewalAt: null });
  s.at(RENEWS); assert.equal((await s.job()).charged, 0); assert.equal(s.paypal.charges, 0);
  assert.equal((await renewalJob({ enabled: false })()).enabled, false);
});

test('first purchase saves PayPal with consent; the renewal is charged once on the renewal day at the renewal price', async t => {
  const s = await buy(t);
  assert.equal(s.created.autoRenewal, true); assert.equal(liveOrder({ ...s.created, sandbox: false }).autoRenewal, true);
  const order = await s.store.get(s.created.orderId);
  assert.ok(order.auto_renewal_consent_at, 'agree click recorded as consent');
  assert.deepEqual(await s.renewals.view(s.user), { available: true, enabled: true, state: 'active', nextRenewalAt: new Date(RENEWS).toISOString() });
  // Nothing before the 7-day window, then one phone notice (no email), never twice.
  // One email 30 days before (as the terms say), never twice, no phone notice.
  s.at(RENEWS - 31 * DAY); await s.job(); assert.equal(s.mails.length, 0);
  s.at(RENEWS - 30 * DAY + 3600000); assert.equal((await s.job()).notices, 1); await s.job();
  s.at(RENEWS - 7 * DAY); await s.job();
  assert.equal(s.mails.length, 1);
  assert.equal(s.mails[0].subject, 'RESOLUTE 通知機能の更新のお知らせ'); assert.equal(s.mails[0].to, 'buyer@example.com');
  assert.equal(s.mails[0].text, '12月16日に、RESOLUTEの通知機能を1年分自動で更新します。\n更新料は5,980円で、ご登録のPayPalにてお支払いいただきます。\n停止をご希望の方は、更新日の前日までにアカウント画面からお手続きください。');
  assert.equal(s.paypal.charges, 0, 'no charge at notice time');
  // The day before the renewal day (JST): still nothing.
  s.at(renewalDayStart(new Date(RENEWS).toISOString()) - 60000); await s.job(); assert.equal(s.paypal.charges, 0);
  s.at(renewalDayStart(new Date(RENEWS).toISOString()) + 60000);
  const report = await s.job();
  assert.equal(report.charged, 1); assert.equal(s.paypal.charges, 1);
  const renewal = [...s.paypal.keys.values()][0];
  assert.equal(renewal.purchase_units[0].amount.value, '5980');
  const plan = await s.renewals.view(s.user);
  assert.equal(plan.nextRenewalAt, '2028-12-16T03:00:01.000Z', 'the new year starts where the old one ends');
  for (let i = 0; i < 3; i++) await s.job();
  assert.equal(s.paypal.charges, 1, 'no second charge for the same period');
  const grants = (await s.db.query("SELECT kind, starts_at, expires_at FROM resolute_payments_live.grants ORDER BY starts_at")).rows;
  assert.deepEqual(grants.map(g => g.kind), ['initial', 'renewal']);
});

test('PRO membership is read from server records at charge time: member price, whatever it was at purchase', async t => {
  const s = await buy(t);
  s.users.set(s.user, account(s.user, true));
  s.at(RENEWS - 30 * DAY + 60000); await s.job();
  assert.match(s.mails[0].text, /更新料は3,980円で/, 'the email shows the member price');
  s.at(RENEWS - 60000); await s.job();
  const renewal = [...s.paypal.keys.values()][0];
  assert.equal(renewal.purchase_units[0].amount.value, '3980');
  const order = await s.store.findPaypal(renewal.id);
  assert.equal(order.quote.priceClass, 'pro'); assert.equal(order.state, 'paid');
  // English buyers pay in USD: $39 / PRO $29 (same table as quote()).
  assert.equal(renewalMessage('upcoming_auto', 'en', new Date(RENEWS).toISOString(), '$29').text,
    'Your RESOLUTE alerts will renew automatically for another year on December 16, 2027. The renewal fee of $29 will be charged to your PayPal account on file. To stop the renewal, please do so from your account page before December 16, 2027.');
});

test('a lost answer is retried with the same PayPal-Request-Id; PayPal replays it and nothing is charged twice', async t => {
  const s = await buy(t);
  s.paypal.next = 'lost'; s.at(RENEWS - 60000);
  assert.equal((await s.job()).uncertain, 1);
  s.paypal.next = 'complete';
  assert.equal((await s.job()).charged, 1);
  assert.equal(s.paypal.charges, 1); assert.equal(s.paypal.keys.size, 1);
  // PayPal unreachable before anything was created, beyond the replay window: stop and ask the operator.
  const t2 = await buy(t, { user: 'user_buyer2' });
  t2.paypal.next = 'down'; t2.at(RENEWS - 60000); await t2.job();
  t2.at(RENEWS - 60000 + 7 * 3600000); t2.paypal.next = 'complete';
  const report = await t2.job();
  assert.equal(report.review, 1); assert.equal(t2.paypal.charges, 0);
  assert.equal((await t2.renewals.view(t2.user)).state, 'review');
  assert.ok((await t2.db.query("SELECT 1 FROM resolute_payments_live.alert_outbox")).rows.length > 0, 'operator alert queued');
});

test('declines retry on day 0, +1 and +3, then stop, tell the member (email when no phone) and never charge again', async t => {
  const s = await buy(t);
  s.paypal.next = 'decline';
  const start = renewalDayStart(new Date(RENEWS).toISOString()) + 60000;
  s.at(start); assert.equal((await s.job()).declined, 1);
  s.at(start + 3600000); await s.job(); // before the retry time: nothing
  assert.equal((await s.db.query("SELECT count(*)::int n FROM resolute_payments_live.renewal_charges")).rows[0].n, 1);
  s.at(start + DAY); assert.equal((await s.job()).declined, 1);
  s.at(start + 3 * DAY); assert.equal((await s.job()).failed, 1);
  assert.equal((await s.renewals.view(s.user)).state, 'failed');
  const failedMail = s.mails.find(m => m.subject.includes('自動で更新できませんでした'));
  assert.ok(failedMail, 'failure notice by email'); assert.equal(failedMail.to, 'buyer@example.com');
  assert.match(failedMail.text, /料金は請求していません/);
  s.paypal.next = 'complete'; s.at(start + 10 * DAY); await s.job();
  assert.equal(s.paypal.charges, 0);
  const states = (await s.db.query("SELECT state FROM resolute_payments_live.orders WHERE quote->>'kind'='renewal'")).rows.map(r => r.state);
  assert.deepEqual(states, ['declined', 'declined', 'declined']);
});

test('bank-funded PENDING capture: wait, never charge again, grant when PayPal completes it', async t => {
  const s = await buy(t);
  s.paypal.next = 'pending'; s.at(RENEWS - 60000);
  assert.equal((await s.job()).pending, 1); assert.equal((await s.job()).pending, 1);
  const remote = [...s.paypal.keys.values()][0];
  remote.purchase_units[0].payments.captures[0].status = 'COMPLETED';
  assert.equal((await s.job()).charged, 1); assert.equal(s.paypal.charges, 1);
});

test('stop anytime from the account screen (also while sales are closed); restart only before the renewal day', async t => {
  const s = await buy(t);
  assert.equal((await s.engine.setAutoRenewal(s.user, { enabled: false })).enabled, false);
  s.at(RENEWS - 30 * DAY + 60000); await s.job();
  assert.equal(s.mails[0].text, '12月16日でRESOLUTEの通知機能のご利用期間が終わります。続けてご利用の方は、アカウント画面から更新のお手続きをお願いします。', 'stopped members get the renew-by-hand email');
  s.at(RENEWS - 60000); await s.job(); assert.equal(s.paypal.charges, 0);
  s.at(RENEWS + 60000);
  await assert.rejects(s.engine.setAutoRenewal(s.user, { enabled: true }), /AUTO_RENEWAL_UNAVAILABLE/);
  const r = await buy(t, { user: 'user_buyer3' });
  await r.engine.setAutoRenewal(r.user, { enabled: false });
  assert.equal((await r.engine.setAutoRenewal(r.user, { enabled: true })).enabled, true);
  await assert.rejects(r.engine.setAutoRenewal(r.user, { enabled: 'yes' }), /INVALID_PAYMENT_INPUT/);
  await assert.rejects(r.engine.setAutoRenewal(r.user, { enabled: true, extra: 1 }), /INVALID_PAYMENT_INPUT/);
  await assert.rejects(r.engine.autoRenewal('guest_' + 'a'.repeat(64)), /AUTO_RENEWAL_UNAVAILABLE/);
});

test('refunds are untouched: a refunded first purchase ends the plan and is never renewed', async t => {
  const s = await buy(t);
  const order = await s.store.get(s.created.orderId);
  await s.store.adverse(order.paypal_id, 'revoked', 'PAYMENT.CAPTURE.REFUNDED', 'evt-refund');
  s.at(RENEWS - 60000); await s.job();
  assert.equal(s.paypal.charges, 0); assert.equal((await s.renewals.view(s.user)).state, 'ended');
});

test('without a saved PayPal (guest card, PayPal declined to save) the member falls back to the notice and renews by hand', async t => {
  const s = await buy(t, { vault: { status: 'APPROVED', id: 'tok_later' } });
  assert.equal((await s.renewals.view(s.user)).available, false);
  assert.ok((await s.db.query("SELECT 1 FROM resolute_payments_live.audit WHERE code='AUTO_RENEWAL_NOT_SAVED'")).rows.length);
  s.at(RENEWS - 30 * DAY + 60000); await s.job();
  assert.equal(s.mails[0].text, '12月16日でRESOLUTEの通知機能のご利用期間が終わります。続けてご利用の方は、アカウント画面から更新のお手続きをお願いします。');
  s.at(RENEWS - 60000); await s.job(); assert.equal(s.paypal.charges, 0);
  // PayPal later sends the saved token (APPROVED → VAULTED): enrolled through the webhook.
  const engine = paymentEngine({ store: s.store, renewals: s.renewals, merchantId: MID, environment: 'live', getUser: async id => account(id),
    paypal: { ...s.paypal, verify: async () => true } });
  const paypalId = (await s.store.get(s.created.orderId)).paypal_id;
  await engine.webhook(new Headers(), { id: 'WH-1', event_type: 'VAULT.PAYMENT-TOKEN.CREATED', resource: { id: 'tok_later', metadata: { order_id: paypalId } } });
  assert.equal((await s.renewals.view(s.user)).enabled, true);
  await engine.webhook(new Headers(), { id: 'WH-2', event_type: 'VAULT.PAYMENT-TOKEN.DELETED', resource: { id: 'tok_later' } });
  assert.equal((await s.renewals.view(s.user)).state, 'ended');
});

test('owner accounts keep full access to the automatic-renewal controls', async t => {
  const s = await buy(t, { user: OWNER_ACCOUNT_ID });
  const http = paymentHttp({ engine: s.engine, store: s.store, environment: 'live', enabled: true, allowedUsers: null,
    authenticate: async () => OWNER_ACCOUNT_ID, access: async () => ({}) });
  const get = await http(new Request('https://api.test/internal/v1/live-payments/auto-renewal'));
  assert.equal(get.status, 200); assert.equal((await get.json()).enabled, true);
  const post = await http(new Request('https://api.test/internal/v1/live-payments/auto-renewal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"enabled":false}' }));
  assert.equal(post.status, 200); assert.equal((await post.json()).enabled, false);
});

test('PayPal requests: vault only when offered, merchant-initiated renewal with vault_id and the order\'s own Request-Id', async () => {
  const calls = [];
  let status = 201;
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'x', expires_in: 3600 });
    if (status !== 201) return new Response('{}', { status, headers: { 'content-type': 'application/json' } });
    return Response.json({ id: 'ORDER0001' }, { status: 201 });
  };
  const paypal = createPaypal({ base: 'https://api-m.sandbox.paypal.com', clientId: 'c', secret: 's', merchantId: MID, webhookId: 'w' }, fetcher);
  const quote = { kind: 'initial', language: 'ja', currency: 'JPY', value: '7980', minor: 7980, sku: 'resolute_v1:initial' };
  const order = { id: randomUUID(), quote, auto_renewal_offered: false };
  await paypal.create(order);
  assert.equal(JSON.parse(calls.at(-1).options.body).payment_source.paypal.attributes, undefined);
  await paypal.create({ ...order, auto_renewal_offered: true });
  const source = JSON.parse(calls.at(-1).options.body).payment_source.paypal;
  assert.deepEqual(source.attributes, { vault: { store_in_vault: 'ON_SUCCESS', usage_type: 'MERCHANT', customer_type: 'CONSUMER' } });
  assert.equal(source.experience_context.landing_page, 'GUEST_CHECKOUT');
  const renewal = { id: randomUUID(), capture_key: randomUUID(), quote: { ...quote, kind: 'renewal', value: '5980', minor: 5980, sku: 'resolute_v1:renewal' } };
  await paypal.charge(renewal, 'tok_saved1');
  const body = JSON.parse(calls.at(-1).options.body);
  assert.deepEqual(body.payment_source, { paypal: { vault_id: 'tok_saved1' } });
  assert.equal(calls.at(-1).options.headers['PayPal-Request-Id'], renewal.capture_key);
  assert.equal(body.purchase_units[0].invoice_id, renewal.id);
  await assert.rejects(paypal.charge({ ...renewal, quote }, 'tok_saved1'), /INVALID_PAYMENT_INPUT/);
  await assert.rejects(paypal.charge(renewal, 'bad token!'), /INVALID_PAYMENT_INPUT/);
  status = 422; await assert.rejects(paypal.charge(renewal, 'tok_saved1'), /PAYPAL_DECLINED/);
  status = 500; await assert.rejects(paypal.charge(renewal, 'tok_saved1'), /PAYPAL_UNAVAILABLE/);
  status = 409; await assert.rejects(paypal.charge(renewal, 'tok_saved1'), /PAYPAL_UNAVAILABLE/);
  status = 422; await assert.rejects(paypal.create(order), /PAYPAL_UNAVAILABLE/, 'only renewals read 4xx as a decline');
  assert.equal(savedPaypal({ payment_source: { paypal: { attributes: { vault: { id: 'a', status: 'APPROVED' } } } } }), null);
});

test('notices: the owner\'s wording word for word, date and price formats, email only (no phone notice)', async () => {
  const end = '2027-12-16T03:00:01Z';
  assert.equal(renewalDate(end, 'ja'), '12月16日'); assert.equal(renewalDate(end, 'en'), 'December 16, 2027');
  assert.equal(renewalDate('2027-12-15T15:00:00Z', 'ja'), '12月16日', 'JST date');
  assert.equal(renewalPrice({ currency: 'JPY', value: '5980' }), '5,980円'); assert.equal(renewalPrice({ currency: 'USD', value: '39.00' }), '$39');
  assert.deepEqual(renewalMessage('upcoming_auto', 'ja', end, '5,980円'), { subject: 'RESOLUTE 通知機能の更新のお知らせ', text: '12月16日に、RESOLUTEの通知機能を1年分自動で更新します。\n更新料は5,980円で、ご登録のPayPalにてお支払いいただきます。\n停止をご希望の方は、更新日の前日までにアカウント画面からお手続きください。' });
  assert.deepEqual(renewalMessage('upcoming_manual', 'ja', end), { subject: 'RESOLUTE 通知機能の更新のお知らせ', text: '12月16日でRESOLUTEの通知機能のご利用期間が終わります。続けてご利用の方は、アカウント画面から更新のお手続きをお願いします。' });
  assert.deepEqual(renewalMessage('upcoming_manual', 'en', end), { subject: 'Your RESOLUTE alerts renewal', text: 'Your RESOLUTE alerts end on December 16, 2027. To keep using them, please renew from your account page.' });
  assert.throws(() => renewalMessage('upcoming_auto', 'ja', end));
  assert.ok(!read('../scripts/research/web_push.py').includes('/research/account'), 'no phone notice for renewal');
  assert.ok(!read('../services/resolute-api/payments/renewal.mjs').includes('push.send'));
  assert.match(noticeKey('user_a', '2027-12-16T03:00:00Z', 'upcoming_auto'), /^[a-f0-9]{32}$/);
  assert.equal(primaryEmail(account('user_a')), 'buyer@example.com');
  assert.equal(primaryEmail({ ...account('user_a'), emailAddresses: [{ id: 'e1', emailAddress: 'x@example.com', verification: { status: 'unverified' } }] }), null);
  const sent = [];
  const mail = renewalMailProvider({ apiKey: 're_' + 'a'.repeat(20), from: 'RESOLUTE <noreply@techphase.app>'.replace(/.*<|>/g, '') },
    async (url, options) => { sent.push({ url, options }); return Response.json({ id: 'mail-1' }); });
  const key = noticeKey('user_a', '2027-12-16T03:00:00Z', 'upcoming_auto');
  assert.equal(await mail.send(key, 'buyer@example.com', { subject: 's', text: 't' }), 'mail-1');
  assert.equal(sent[0].url, 'https://api.resend.com/emails'); assert.equal(sent[0].options.headers['Idempotency-Key'], 'resolute-renewal-' + key);
  await assert.rejects(mail.send('nothex', 'buyer@example.com', {}), /Invalid/);
});

test('screens: exactly one checkout line behind the server flag, the account toggle, and the proxy allows stopping while sales are closed', async () => {
  const live = read('../app/resolute/checkout/live-screen.tsx'), agree = read('../app/legal/agree-button.tsx');
  assert.ok(agree.includes('ja: "1年後から自動で更新されます。いつでも止められます"'));
  assert.ok(agree.includes('en: "Renews automatically after one year. You can stop it anytime."'));
  // The 「ご希望の方だけ更新します」 line is replaced (not added to) for an auto-renewal order; flag off = today's lines.
  assert.match(live, /<CheckoutLines lines=\{resoluteCheckoutLines\(en,order\.autoRenewal===true\)\} \/>\n    <AgreeButton/);
  const { resoluteCheckoutLines, RESOLUTE_CHECKOUT_LINES } = legalModule('../../legal/agree-button');
  assert.deepEqual(resoluteCheckoutLines(false, false), RESOLUTE_CHECKOUT_LINES.ja);
  assert.deepEqual(resoluteCheckoutLines(false, true), ['1年後から自動で更新されます。いつでも止められます', RESOLUTE_CHECKOUT_LINES.ja[1]]);
  assert.deepEqual(resoluteCheckoutLines(true, true), ['Renews automatically after one year. You can stop it anytime.', RESOLUTE_CHECKOUT_LINES.en[1]]);
  // Renew by hand from the account page: the existing 「通知サービスを更新」 button opens the renewal checkout (members only).
  assert.match(read('../app/research/account/account-view.tsx'), /"\/resolute\/checkout\?lang=ja&kind=renewal"[^\n]*通知サービスを更新/);
  assert.match(read('../app/resolute/checkout/page.tsx'), /renewal=\{params\.kind === "renewal" && !order\}/);
  assert.match(live, /kind=renewal && !guest \? "renewal" as const : "initial" as const/);
  assert.match(read('../app/resolute/checkout/live-identity.tsx'), /props\.guestEnabled && !props\.renewal/);
  const route = read('../app/api/resolute/live-payments/[...action]/route.ts');
  assert.match(route, /\["claim", "recovery\/claim", "auto-renewal"\]\.includes\(path\) && process\.env\.RESOLUTE_LIVE_SALES_ENABLED/);
  const view = read('../app/research/account/account-view.tsx');
  assert.match(view, /\/api\/resolute\/live-payments\/auto-renewal/);
  assert.throws(() => liveOrder({ orderId: randomUUID(), sandbox: false, state: 'created', expiresAt: new Date().toISOString(), autoRenewal: false,
    quote: { kind: 'initial', language: 'ja', currency: 'JPY', value: '7980', priceClass: 'launch' } }));
  // The job is never scheduled by the repository; the worker prints only {"enabled":false} while the flag is off.
  assert.match(read('../services/resolute-api/payments/renewal-worker.mjs'), /RESOLUTE_AUTO_RENEWAL_ENABLED !== 'true'/);
});

test('stop deadline: stopping by the day before the renewal date means no charge; the charge happens on the renewal date (JST)', async t => {
  const dayStart = renewalDayStart(new Date(RENEWS).toISOString());
  assert.equal(new Date(dayStart + 9 * 3600000).toISOString().slice(0, 10), '2027-12-16');
  const s = await buy(t);
  s.at(dayStart - 60000); // 23:59 JST on 12/15, the day before
  assert.equal((await s.engine.setAutoRenewal(s.user, { enabled: false })).enabled, false);
  s.at(dayStart + 60000); await s.job(); s.at(RENEWS + DAY); await s.job();
  assert.equal(s.paypal.charges, 0);
  const k = await buy(t, { user: 'user_buyer4' });
  k.at(dayStart - 60000); await k.job(); assert.equal(k.paypal.charges, 0, 'nothing the day before');
  k.at(dayStart + 60000); await k.job(); assert.equal(k.paypal.charges, 1, 'charged on 12/16 JST');
});
