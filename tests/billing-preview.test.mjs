import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The pre-purchase review screen (for a legal review) must never reach a payment: owner only, calls nothing, button disabled.
const page = readFileSync('app/research/account/billing/page.tsx', 'utf8');
const screen = readFileSync('app/research/account/billing/screen.tsx', 'utf8');
test('the review screen is reachable only by the owner, before any live-sales check', () => {
  const at = page.indexOf('wantsPreview) {');
  assert.ok(at > 0);
  const block = page.slice(at, page.indexOf('}\n  if (!live', at));
  assert.match(block, /!isOwnerAccount\(userId\)\) notFound\(\)/);
  assert.match(block, /preview \/>/);
});
test('in the review screen no API is called, create is refused and the buttons are disabled', () => {
  assert.match(screen, /if \(preview\) \{ setReady\(true\); setSalesReady\(true\);.*return; \}/);
  assert.match(screen, /if \(preview\) return; \/\/ the review screen never starts a payment/);
  assert.match(screen, /disabled=\{!agreed \|\| busy \|\| preview\}/);
  assert.match(screen, /確認用の表示です（購入はできません）/);
});

test('both owner accounts (production and preview) can open the review screen; others get 404', async () => {
  const ts = (await import('typescript')).default;
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  let user = null;
  const compiled = ts.transpileModule(page, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const m = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === '@clerk/nextjs/server') return { auth: async () => ({ userId: user }) };
    if (name === 'next/navigation') return { notFound: () => { throw Error('404'); }, redirect: path => { throw Error('REDIRECT:' + path); } };
    if (name === '@/lib/membership/entitlements') return { OWNER_ACCOUNT_ID: 'preview-owner', isOwnerAccount: id => id === 'preview-owner' || id === 'production-owner' };
    if (name === '@/services/tech-phase-billing/access.mjs') return { sandboxMemberAllowed: () => false };
    if (name === '@/services/tech-phase-billing/live-http.mjs') return { liveEnabled: () => false };
    if (name === './screen') return { default: function Screen() {} };
    return require(name);
  }, m, m.exports);
  const props = { searchParams: Promise.resolve({ preview: 'purchase' }) };
  user = null; await assert.rejects(m.exports.default(props), /REDIRECT:\/research\/account/);
  user = 'someone-else'; await assert.rejects(m.exports.default(props), /404/);
  for (const owner of ['preview-owner', 'production-owner']) { user = owner; assert.ok(await m.exports.default(props)); }
});
