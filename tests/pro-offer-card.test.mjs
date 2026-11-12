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
  new Function('require', 'module', 'exports', out)(id => id.endsWith('.module.css') ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : id in stubs ? stubs[id] : require(id), mod, mod.exports);
  return mod.exports;
}
const card = load('../app/research/pro-offer-card.tsx', { 'next/link': { default: ({ children, ...p }) => createElement('a', p, children) } });
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
test('first render: yearly; JPY for Japanese, USD for English; the 17% bubble is not interactive', () => {
  const ja = html(true), en = html(false);
  assert.match(ja, /29,800円/); assert.match(ja, /35,760円/); assert.match(ja, /17%OFF/); assert.match(ja, /PayPalで申し込む/);
  assert.match(ja, /無料プランのすべての機能に加えて/);
  assert.match(en, /\$200/); assert.match(en, /17% OFF/); assert.match(en, /Subscribe with PayPal/); assert.match(en, /Everything in Free, plus/);
  assert.match(en, /JPY/); assert.match(en, /Monthly/); assert.match(en, /Yearly/);
  assert.doesNotMatch(ja, /自動更新|返金|NEW/); // no renewal/refund prose inside the card
  const css = readFileSync(new URL('../app/research/plan-cards.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.bubble \{[^}]*pointer-events:none/);
  assert.match(css, /prefers-reduced-motion:reduce\) \{ \.paypal::after \{ animation:none/);
});
test('the PayPal button goes straight to PayPal: a real button when a handler is given, never a sheet', () => {
  const button = html(true, { href: undefined, onSubscribe: () => {} });
  assert.match(button, /<button[^>]*class="paypal"[^>]*>PayPalで申し込む<\/button>/);
  assert.match(html(true, { href: undefined, onSubscribe: () => {}, busy: true }), /disabled=""[^>]*>PayPalへ移動しています/);
});
test('the FREE card shows 0円 / 月 with the same price classes as PRO; the note sits outside the cards', () => {
  const src = readFileSync(new URL('../app/research/plan-cards.tsx', import.meta.url), 'utf8');
  assert.match(src, /styles\.priceRow\}><span className=\{styles\.priceN\}>\{t\("0円", "¥0"\)\}<\/span><span className=\{styles\.priceU\}>\{t\("\/ 月", "\/ month"\)\}/);
  assert.match(src, /PROプランは自動更新です。解約はマイアカウントからいつでも可能です。/);
  assert.match(src, /PRO renews automatically\. Cancel anytime from My Account\./);
  assert.match(src, /Terms.*Legal Notice/s);
  assert.doesNotMatch(readFileSync(new URL('../app/research/account/account-view.tsx', import.meta.url), 'utf8'), /料金と規約を確認してから/);
});
