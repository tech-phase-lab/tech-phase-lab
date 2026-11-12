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
  assert.match(block, /userId !== OWNER_ACCOUNT_ID\) notFound\(\)/);
  assert.match(block, /preview \/>/);
});
test('in the review screen no API is called, create is refused and the buttons are disabled', () => {
  assert.match(screen, /if \(preview\) \{ setReady\(true\); setSalesReady\(true\);.*return; \}/);
  assert.match(screen, /if \(preview\) return; \/\/ the review screen never starts a payment/);
  assert.match(screen, /disabled=\{!agreed \|\| busy \|\| preview\}/);
  assert.match(screen, /確認用の表示です（購入はできません）/);
});
