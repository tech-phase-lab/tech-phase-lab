// Lawyer review, Nov 24 (owner pack legal-final-1124): consent line above every purchase button (client and server),
// RESOLUTE renewal stop deadline and URL, the 特商法 page's start time and withdrawal line, privacy purposes, and the name check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { CONSENT_ERROR, CONSENT_LINE, NO_CONSENT, pressPurchase, tickConsent } from '../lib/legal/consent.ts';
import { consentTime, PaymentError } from '../services/resolute-api/payments/policy.mjs';
import { paymentEngine } from '../services/resolute-api/payments/engine.mjs';
import { checkoutService, consentTime as proConsentTime } from '../services/tech-phase-billing/checkout.mjs';
import { renewalMessage, RENEWAL_STOP_URL } from '../services/resolute-api/payments/renewal.mjs';
import commerceJa from '../lib/legal/commerce-ja.ts';
import commerceEn from '../lib/legal/commerce-en.ts';
import privacyJa from '../lib/legal/privacy-ja.ts';
import privacyEn from '../lib/legal/privacy-en.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-24T03:00:00Z');

test('consent state: unticked first; pressing without the tick gives no time and shows the red line; ticking clears it', () => {
  assert.deepEqual(CONSENT_LINE.ja, { before: '', terms: '利用規約', between: 'と', privacy: 'プライバシーポリシー', after: 'に同意する' });
  assert.equal(Object.values(CONSENT_LINE.en).join(''), 'I agree to the Terms of Service and Privacy Policy');
  assert.deepEqual(CONSENT_ERROR, { ja: '同意のチェックを入れてください', en: 'Please check the box to agree' });
  const pressed = pressPurchase(NO_CONSENT);
  assert.equal(pressed.consentAt, null); assert.equal(pressed.state.missing, true);
  const ticked = tickConsent(true, NOW);
  assert.deepEqual(ticked, { agreedAt: '2026-11-24T03:00:00.000Z', missing: false });
  assert.equal(pressPurchase(ticked).consentAt, '2026-11-24T03:00:00.000Z');
  assert.deepEqual(tickConsent(false, NOW), NO_CONSENT);
});

test('client: the RESOLUTE LP button starts nothing without the tick, shows the red line under it, and sends the tick time', async () => {
  const dir = await mkdtemp(join(process.cwd(), '.consent-')), require = createRequire(import.meta.url);
  const React = require('react'), { createRoot } = require('react-dom/client');
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://site.test/resolute/lp' });
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'], before = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  let root;
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: dom.window });
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: dom.window.document });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const outfile = join(dir, 'buy.cjs');
    await build({ entryPoints: ['app/resolute/lp/buy-button.tsx'], outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' } });
    const BuyButton = require(outfile).default, bodies = [], visits = [];
    globalThis.fetch = async (url, options) => { bodies.push([String(url), JSON.parse(options.body)]); return Response.json({ error: 'PAYMENT_DISABLED' }, { status: 503 }); };
    root = createRoot(document.getElementById('root'));
    await React.act(async () => root.render(React.createElement(BuyButton, { language: 'ja', shownValue: '7980', className: 'cta', navigate: url => visits.push(url) }, 'RESOLUTEを手に入れる')));
    const box = document.querySelector('input[type=checkbox]'), link = document.querySelector('a[data-buy]');
    // The line sits right above the button, unticked, with both links.
    assert.equal(box.checked, false); assert.equal(box.closest('label').nextElementSibling, link);
    assert.equal(box.closest('label').textContent, '利用規約とプライバシーポリシーに同意する');
    assert.deepEqual([...box.closest('label').querySelectorAll('a')].map(a => a.getAttribute('href')), ['/terms', '/privacy']);
    await React.act(async () => { link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
    assert.equal(bodies.length, 0); assert.equal(visits.length, 0);
    const error = document.querySelector('[data-consent-error]');
    assert.equal(error.textContent, '同意のチェックを入れてください'); assert.equal(link.nextElementSibling, error);
    await React.act(async () => { box.click(); });
    assert.equal(document.querySelector('[data-consent-error]'), null);
    await React.act(async () => { link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
    assert.equal(bodies[0][0], '/api/resolute/live-payments/orders');
    assert.ok(Number.isFinite(Date.parse(bodies[0][1].consentAt)));
    assert.deepEqual(Object.keys(bodies[0][1]).sort(), ['consentAt', 'kind', 'language', 'requestKey']);
  } finally {
    if (root) await React.act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of before) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    await rm(dir, { recursive: true, force: true });
  }
});

test('client: every purchase button has the consent line right above it and the red line right under it', () => {
  const expect = {
    '../app/research/pro-offer-card.tsx': 2, '../app/research/account/account-sheets.tsx': 1, '../app/research/account/billing/screen.tsx': 2,
    '../app/resolute/checkout/live-screen.tsx': 2, '../app/resolute/checkout/screen.tsx': 2, '../app/resolute/lp/buy-button.tsx': 1,
  };
  for (const [file, n] of Object.entries(expect)) {
    const src = read(file);
    assert.equal(src.match(/<ConsentCheck /g)?.length, n, file);
    assert.equal(src.match(/<ConsentError /g)?.length, n, file);
    assert.match(src, /consent\.require\(\)/, file);
    assert.doesNotMatch(src, /disabled=\{!agreed/, file); // the button is never greyed out for want of the tick
  }
  assert.match(read('../app/research/pro-offer-card.tsx'), /<ConsentCheck en=\{!ja\} consent=\{consent\} \/>\n\s*<AgreeButton[^\n]*\/><ConsentError/);
  // RESOLUTE (owner, Nov 24): no button after PayPal; 「PayPalへ進む」 for an order not yet approved has its own line.
  assert.match(read('../app/resolute/checkout/live-screen.tsx'), /<ConsentCheck en=\{en\} consent=\{consent\} \/>\n\s*<a className=\{styles\.button\} href=\{approval\}[^\n]*toPaypal\(approval\)[^\n]*\n\s*<ConsentError/);
  assert.match(read('../app/research/account/account-sheets.tsx'), /billingRequest\("create", \{ currency, period, acceptedTerms: [^}]*, consentAt \}/);
});

test('server (RESOLUTE): no order or capture without a consent time; the time is stored with the order', async () => {
  assert.equal(consentTime('2026-11-24T02:59:00.000Z', NOW), '2026-11-24T02:59:00.000Z');
  for (const bad of [undefined, null, '', 'yesterday', '2026-11-24', 1764000000000, '2026-11-24T03:20:00.000Z'])
    assert.throws(() => consentTime(bad, NOW), e => e instanceof PaymentError && e.code === 'CONSENT_REQUIRED', String(bad));
  let stored = null;
  const user = { id: 'user_test', primaryEmailAddressId: 'e', emailAddresses: [{ id: 'e', verification: { status: 'verified' } }], privateMetadata: {} };
  const store = {
    async create(_u, _k, makeQuote) { stored = await makeQuote({ use: false }); return { id: 'o', state: 'created', quote: stored, expires_at: new Date(NOW + 9e5).toISOString(), paypal_id: 'P' }; },
    async get() { return { id: '12345678-1234-4234-8234-123456789abc', user_id: 'user_test', state: 'created', quote: { kind: 'initial' } }; },
  };
  const engine = paymentEngine({ store, paypal: { approval: async () => null }, getUser: async () => user, now: () => NOW });
  const body = { kind: 'initial', language: 'ja', requestKey: '12345678-1234-4234-8234-123456789abc' };
  await assert.rejects(engine.create('user_test', body), /INVALID_PAYMENT_INPUT/);
  await assert.rejects(engine.create('user_test', { ...body, consentAt: null }), /CONSENT_REQUIRED/);
  assert.equal(stored, null);
  await engine.create('user_test', { ...body, consentAt: '2026-11-24T02:58:00.000Z' });
  assert.equal(stored.termsConsentAt, '2026-11-24T02:58:00.000Z'); assert.equal(stored.value, '7980');
  // One tick (owner, Nov 24): completing may omit the tick time and use the one stored with the order — which this
  // order (made before the consent line) does not have, so it is refused.
  await assert.rejects(engine.capture('user_test', { orderId: body.requestKey }), /CONSENT_REQUIRED/);
  await assert.rejects(engine.capture('user_test', { orderId: body.requestKey, other: 1 }), /INVALID_PAYMENT_INPUT/);
  await assert.rejects(engine.capture('user_test', { orderId: body.requestKey, consentAt: '' }), /CONSENT_REQUIRED/);
  // An order without a stored consent (made before this change) cannot be paid.
  await assert.rejects(engine.capture('user_test', { orderId: body.requestKey, consentAt: '2026-11-24T02:59:00.000Z' }), /CONSENT_REQUIRED/);
  // The capture-time tick is written next to it, in the same statement that starts the capture.
  assert.match(read('../services/resolute-api/payments/store.mjs'), /ELSE quote \|\| jsonb_build_object\('captureConsentAt',\$4::text\) END/);
});

test('server (PRO): no checkout without a consent time; the time is stored on the subscription row', async () => {
  assert.throws(() => proConsentTime(undefined, NOW), /CONSENT_REQUIRED/);
  const reserved = [];
  const svc = checkoutService({ termsVersion: 'pro-live-v1', now: () => NOW,
    store: { reserve: async (...args) => { reserved.push(args); return { id: 'r', paypal_id: 'I-1' }; } },
    paypal: { get: async () => ({ id: 'I-1', custom_id: 'r', status: 'ACTIVE' }) } });
  await assert.rejects(svc.start('user_a', 'JPY', 'pro-live-v1', 'month'), /CONSENT_REQUIRED/);
  await assert.rejects(svc.start('user_a', 'JPY', 'pro-live-v1', 'month', '2027-01-01T00:00:00.000Z'), /CONSENT_REQUIRED/);
  assert.equal(reserved.length, 0);
  await svc.start('user_a', 'JPY', 'pro-live-v1', 'year', '2026-11-24T02:58:00.000Z');
  assert.deepEqual(reserved[0], ['user_a', 'JPY', 'pro-live-v1', 'year', '2026-11-24T02:58:00.000Z']);
  for (const file of ['../services/tech-phase-billing/http.mjs', '../services/tech-phase-billing/live-http.mjs'])
    assert.match(read(file), /\['currency','acceptedTerms','consentAt'\]/, file);
  assert.match(read('../services/tech-phase-billing/store.mjs'), /terms_version,terms_consent_at\)/);
  assert.match(read('../db/tech-phase/010_terms_consent.sql'), /ADD COLUMN IF NOT EXISTS terms_consent_at timestamptz/);
});

test('RESOLUTE renewal: the 30-day email has the stop line and URL; the purchase line and account screen say the deadline', () => {
  const end = '2027-12-16T03:00:00.000Z';
  assert.equal(renewalMessage('upcoming_auto', 'ja', end, '5,980円').text,
    '12月16日に、RESOLUTEの通知機能を1年分自動で更新します。\n更新料は5,980円で、ご登録のPayPalにてお支払いいただきます。\n停止をご希望の方は、更新日の前日までにアカウント画面からお手続きください。\n\n更新をやめたい人はこちらから手続きしてください\nhttps://techphase.app/research/account');
  assert.ok(renewalMessage('upcoming_auto', 'en', end, '$39').text.endsWith("\n\nIf you'd like to stop renewing, you can do it here:\nhttps://techphase.app/research/account?lang=en"));
  assert.deepEqual(RENEWAL_STOP_URL, { ja: 'https://techphase.app/research/account', en: 'https://techphase.app/research/account?lang=en' });
  const agree = read('../app/legal/agree-button.tsx');
  assert.ok(agree.includes('ja: "1年後から自動で更新されます。更新日の前日までアカウント画面から止められます"'));
  assert.ok(agree.includes('自動更新は、更新日（有効期限の日）の前日までにここで止められます。'));
  assert.match(read('../app/research/account/account-view.tsx'), /renewal\?\.available && renewal\.enabled && <p[^>]*data-renewal-stop="">\{t\(RESOLUTE_RENEWAL_STOP_NOTE\.ja, RESOLUTE_RENEWAL_STOP_NOTE\.en\)\}/);
  // The deadline matches the mechanism: the charge starts at 00:00 JST of the renewal day.
  assert.match(read('../services/resolute-api/payments/renewal.mjs'), /if \(time < renewalDayStart\(p\.next_renewal_at\)\) continue;/);
});

test('特商法: start within 2 days of payment and "no withdrawal after applying" for both; nothing else said "すぐ"', () => {
  assert.equal(commerceJa.match(/決済完了後2日以内に利用を開始できます/g).length, 2);
  assert.equal(commerceJa.match(/\| 申し込みの撤回 \| 契約の申し込み後は撤回できません \|/g).length, 2);
  assert.match(commerceJa, /\| 申し込みの撤回 \| 契約の申し込み後は撤回できません \|\n\| 解約 \|/);
  assert.doesNotMatch(commerceJa, /すぐ/);
  assert.equal(commerceJa.match(/\| 事業者の氏名 \| ご請求があればメールでお知らせします \|/g).length, 2);
  assert.equal(commerceEn.match(/You can start using it within 2 days after payment is completed/g).length, 2);
  assert.equal(commerceEn.match(/\| Withdrawal of application \| Once you have applied, the contract cannot be withdrawn \|/g).length, 2);
  assert.doesNotMatch(commerceEn, /right after payment/);
});

test('privacy: the four purposes first, the existing ones not covered by them kept', () => {
  const ja = privacyJa.split('## 3. 利用目的')[1].split('## 4.')[0].split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2));
  assert.deepEqual(ja, ['会員登録と本人確認のため', 'サービスの料金の請求のため', '料金や更新のご案内メールを送るため', 'サービスの向上のため',
    '本サービスと本商品の提供、ログイン、契約や購入の管理、更新時期のお知らせ、自動更新の課金、診断の結果とルールの保存・表示、ルールに基づく通知', '通知の送信', 'お問い合わせへの回答', '不正利用の防止、障害の原因調査', '重要なお知らせの連絡']);
  const en = privacyEn.split('## 3. How We Use Information')[1].split('## 4.')[0].split('\n').filter(l => l.startsWith('- '));
  assert.equal(en.length, 9); assert.equal(en[0], '- To register members and verify their identity');
});

test('name: 「危険度チェッカー」 / "Risk Checker" appear nowhere a user can see', () => {
  const files = [];
  const walk = dir => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|mjs|md|json|py|html)$/.test(name)) files.push(p); } };
  for (const dir of ['app', 'lib', 'content', 'services', 'public']) walk(new URL(`../${dir}`, import.meta.url).pathname);
  for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /危険度チェッカー|Risk Checker/i, file);
});

// Owner, Nov 24: RESOLUTE launches WITH automatic renewal (docs/AUTO-RENEWAL-COPY-PROPOSAL-2026-11-19.md §1–§4). Every public
// page says it renews automatically, how to stop it and by when (更新日の前日まで, lawyer's final review, Nov 24).
test('RESOLUTE auto-renewal copy: LP FAQ, 特商法, Terms Article 21 and privacy, ja and en; the stop deadline everywhere', async () => {
  const lp = read('../app/resolute/lp/landing.tsx'), lpEn = read('../app/resolute/lp/landing-en.tsx');
  assert.ok(lp.includes('1年後から自動で更新され、更新日の30日前にメールでご案内します。自動更新は、更新日の前日までアカウント画面から止められます。'));
  assert.ok(lp.includes('<details><summary>自動更新を止めるには?</summary><p>更新日の前日までに、アカウント画面の「自動更新」から止められます。止めた後も、期限まで通知機能は使えます。</p></details>'));
  assert.ok(lp.includes('5,980円です。更新日にTech Phase PROの会員なら3,980円です。購入時に保存したPayPalで、更新日に自動でお支払いいただきます。'));
  assert.ok(lpEn.includes('You can stop automatic renewal on your account page until the day before the renewal date.'));
  assert.ok(lpEn.includes('<details><summary>How do I stop automatic renewal?</summary><p>You can stop it under “Auto-renewal” on your account page until the day before the renewal date.'));
  const resoluteJa = commerceJa.slice(commerceJa.indexOf('## RESOLUTE')), resoluteEn = commerceEn.slice(commerceEn.indexOf('## RESOLUTE'));
  assert.ok(resoluteJa.includes('| 支払時期 | 申込時に支払います。通知機能の更新料金は、購入から1年ごとの更新日に、購入時に保存したPayPalで自動で支払います（自動更新を止めた方は、更新の手続きをした時に支払います） |'));
  assert.ok(resoluteJa.includes('| 通知機能の更新 | 1年ごとに自動で更新します。更新日の30日前に、登録されたメールアドレスにお知らせします。自動更新は、更新日の前日までにアカウント画面から止められます。止めた後も、期限まで使えます。'));
  assert.ok(resoluteEn.includes('You can stop automatic renewal from your account page until the day before the renewal date'));
  const { default: termsJa } = await import('../lib/legal/terms-ja.ts'), { default: termsEn } = await import('../lib/legal/terms-en.ts');
  const art21 = termsJa.slice(termsJa.indexOf('## 第21条'), termsJa.indexOf('## 第22条')), art21En = termsEn.slice(termsEn.indexOf('## Article 21'), termsEn.indexOf('## Article 22'));
  assert.deepEqual(art21.split('\n').filter(l => /^\d\. /.test(l)).map(l => l.slice(0, 2)), ['1.', '2.', '3.', '4.', '5.', '6.', '7.']);
  assert.ok(art21.includes('4. 初回購入のときに、利用者の同意を得て、支払いに使ったPayPalを保存し、通知機能を1年ごとに自動で更新します。'));
  assert.ok(art21.includes('5. 利用者は、更新日の前日までに、アカウント画面から自動更新を止められます。止めたときは、次の更新の料金はかかりません。'));
  assert.ok(art21.includes('6. 自動で支払えなかったときは、更新日から3日後までの間に支払いをやり直します。'));
  assert.ok(art21En.includes('5. You can stop automatic renewal from your account page until the day before the renewal date.'));
  // Article 19(4): the lawyer asked to stop saying 「すぐ」; same start time as the 特商法 page.
  assert.ok(termsJa.includes('4. 決済完了後2日以内に利用を開始できます。')); assert.doesNotMatch(termsJa, /すぐに使え/);
  assert.ok(termsEn.includes('4. You can start using the Product within 2 days after payment is completed.')); assert.doesNotMatch(termsEn, /right after purchase/);
  assert.ok(privacyJa.includes('自動更新のためにPayPalが発行する支払い方法の識別子') && privacyJa.includes('自動更新の課金'));
  assert.ok(privacyEn.includes('the payment method identifier issued by PayPal (for automatic renewal)'));
});

test('no page says RESOLUTE is never charged or renewed automatically any more', () => {
  const files = [];
  const walk = dir => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|mjs|md|json|html)$/.test(name)) files.push(p); } };
  for (const dir of ['app', 'lib', 'content', 'public']) walk(new URL(`../${dir}`, import.meta.url).pathname);
  for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /自動で課金することはありません|never charged automatically|ご希望の方だけ行います/i, file);
});
