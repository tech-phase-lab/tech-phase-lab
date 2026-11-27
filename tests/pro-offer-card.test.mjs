import { legalModule } from "./support-legal-modules.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
function load(path, stubs = {}) {
  const out = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', out)(id => id.endsWith('.module.css') ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : id in stubs ? stubs[id] : legalModule(id) ?? require(id), mod, mod.exports);
  return mod.exports;
}
const card = load('../app/research/pro-offer-card.tsx', { 'next/link': { default: ({ children, ...p }) => createElement('a', p, children) }, './price-font': { priceFont: { variable: 'price-font' } } });
const html = (ja, extra = {}) => renderToStaticMarkup(createElement(card.default, { ja, href: '/research/account?upgrade=1', ...extra }, createElement('i', null, 'features')));

test('prices: JPY and USD, monthly and yearly, JA and EN, with the 12-month strike-through only for yearly', () => {
  const p = card.offerPrice;
  assert.deepEqual(p('JPY', 'month', true), { amount: '2,980円', unit: '/ 月(税込)', twelveMonths: null });
  assert.deepEqual(p('JPY', 'year', true), { amount: '29,800円', unit: '/ 年(税込)', twelveMonths: '35,760円' });
  assert.deepEqual(p('USD', 'month', true), { amount: '20ドル', unit: '/ 月', twelveMonths: null });
  assert.deepEqual(p('USD', 'year', true), { amount: '200ドル', unit: '/ 年', twelveMonths: '240ドル' });
  assert.deepEqual(p('JPY', 'year', false), { amount: '¥29,800', unit: '/ year (tax incl.)', twelveMonths: '¥35,760' });
  assert.deepEqual(p('USD', 'month', false), { amount: '$20', unit: '/ month', twelveMonths: null });
});
test('first render: monthly (lowest price first); JPY for Japanese, USD for English; the 17% bubble is not interactive', () => {
  const ja = html(true), en = html(false);
  assert.match(ja, /2,980円/); assert.doesNotMatch(ja, /35,760円/); assert.match(ja, /17%OFF/); assert.match(ja, /PayPalで申し込む/);
  assert.match(ja, /無料プランのすべての機能に加えて/);
  assert.match(en, /\$20</); assert.match(en, /17% OFF/); assert.match(en, /Subscribe with PayPal/); assert.match(en, /Everything in Free, plus/);
  assert.match(en, /JPY/); assert.match(en, /Monthly/); assert.match(en, /Yearly/);
  assert.doesNotMatch(ja, /自動更新|返金|NEW/); // no renewal/refund prose inside the card
  const css = readFileSync(new URL('../app/research/plan-cards.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.bubble \{[^}]*pointer-events:none/);
  assert.match(css, /prefers-reduced-motion:reduce\) \{ \.paypal::after \{ animation:none/);
});
test('the PayPal button goes straight to PayPal: a real button when a handler is given, never a sheet', () => {
  const button = html(true, { href: undefined, onSubscribe: () => {} });
  // The account page's button is the final one (owner pack, Nov 17): the lawyer's wording, 「利用規約」 opening the terms, the renewal line above.
  assert.match(button, /<button[^>]*class="paypal"[^>]*aria-label="利用規約に同意して申し込む"[^>]*><span role="link" data-href="\/terms"[^>]*>利用規約<\/span>に同意して申し込む<\/button>/);
  // Lawyer review (Nov 24): the consent tick line sits between the renewal line and the button.
  assert.match(button, /<p>月額・年額とも解約するまで自動更新。いつでも解約できます。<\/p><\/div><label[^>]*data-consent=""><input type="checkbox"[^>]*\/><span><a href="\/terms"[^>]*>利用規約<\/a>と<a href="\/privacy"[^>]*>プライバシーポリシー<\/a>に同意する<\/span><\/label><button/);
  assert.match(html(false, { href: undefined, onSubscribe: () => {} }), /aria-label="Agree to the Terms and buy"[^>]*>Agree to the <span role="link" data-href="\/terms\?lang=en"[^>]*>Terms<\/span> and buy<\/button>/);
  // The introduction card's link only leads to the account page, so it keeps 「PayPalで申し込む」.
  assert.match(html(true, { href: "/research/account?upgrade=1" }), />PayPalで申し込む<\/a>/);
  assert.match(html(true, { href: undefined, onSubscribe: () => {}, busy: true }), /disabled=""[^>]*>PayPalへ移動しています/);
});
test('the FREE card shows 0円 / 月 with the same price classes as PRO; no note under the cards', () => {
  const src = readFileSync(new URL('../app/research/plan-cards.tsx', import.meta.url), 'utf8');
  assert.match(src, /styles\.priceRow\}><span className=\{styles\.priceN\}>\{t\("0円", "¥0"\)\}<\/span><span className=\{styles\.priceU\}>\{t\("\/ 月", "\/ month"\)\}/);
  // Nov 27 (owner): the note under the cards is gone; the footer has the legal links and the billing screen keeps its own disclosure.
  assert.doesNotMatch(src, /PROプランは自動更新です|PRO renews automatically|Legal Notice|styles\.note/);
  assert.doesNotMatch(readFileSync(new URL('../app/research/account/account-view.tsx', import.meta.url), 'utf8'), /料金と規約を確認してから/);
});
test('price figures use Noto Serif JP 700 on both cards, loaded lazily (not preloaded)', () => {
  const css = readFileSync(new URL('../app/research/plan-cards.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.priceN \{ font-family:var\(--font-price-serif\),"Noto Serif JP"[^}]*font-size:var\(--price-size\); font-weight:700/);
  assert.match(css, /--price-size:clamp\(30px,12\.2cqw,48px\)/); // 48px on a wide card, smaller on a phone so the price row stays one line
  assert.match(css, /\.priceRow \{[^}]*flex-wrap:nowrap/);
  assert.match(css, /\.freeCard \.priceRow \{ --price-size:calc\(clamp\(30px,12\.2cqw,48px\) \* \.92\)/); // FREE is slightly smaller than PRO
  const font = readFileSync(new URL('../app/research/price-font.ts', import.meta.url), 'utf8');
  assert.match(font, /preload: false/);
  for (const f of ['pro-offer-card.tsx', 'plan-cards.tsx']) assert.match(readFileSync(new URL('../app/research/' + f, import.meta.url), 'utf8'), /priceFont\.variable/);
});
