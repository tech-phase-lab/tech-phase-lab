// RESOLUTE production QA (Nov 24): ドル never 米ドル, the page language follows the language shown, ?lang=en is honoured
// on the LP and the tools, and the owner review sign-in is in Japanese.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resoluteHtmlLang } from '../lib/resolute/html-lang.ts';
import { resoluteClerkJa } from '../lib/resolute/clerk-localization.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const files = dir => readdirSync(dir).flatMap(name => { const p = join(dir, name); return statSync(p).isDirectory() ? files(p) : /\.(tsx?|mjs)$/.test(name) ? [p] : []; });

test('ドル, never 米ドル, on RESOLUTE screens', () => {
  for (const file of [...files('app/resolute'), ...files('lib/resolute')]) assert.doesNotMatch(readFileSync(file, 'utf8'), /米ドル/, file);
  assert.match(read('../app/resolute/screen.tsx'), /"US dollars · USD":"ドル · USD"/);
});

test('page language: Japanese by default, English for the English LP and ?lang=en; tools follow the language shown', () => {
  assert.equal(resoluteHtmlLang('/resolute', ''), 'ja');
  assert.equal(resoluteHtmlLang('/resolute/lp', ''), 'ja');
  assert.equal(resoluteHtmlLang('/resolute/lp/en', ''), 'en');
  assert.equal(resoluteHtmlLang('/resolute/checkout', '?lang=en&order=x'), 'en');
  assert.equal(resoluteHtmlLang('/resolute/checkout', '?lang=ja'), 'ja');
  assert.equal(resoluteHtmlLang('/resolute/lp/english', ''), 'ja');
  assert.match(read('../app/resolute/layout.tsx'), /<ResoluteHtmlLang \/>\{children\}/);
  const shell = read('../app/resolute/tool-shell.tsx');
  assert.match(shell, /document\.documentElement\.lang=locale/);
  // ?lang is read before the saved preference, and kept like a tap on EN/JA.
  assert.ok(shell.indexOf('get("lang")') < shell.indexOf('requestPreferences('));
  assert.match(shell, /if\(asked==="en" \|\| asked==="ja"\) \{ remember\("locale",asked\); setNormalLocale\(asked\); \}/);
});

test('/resolute/lp?lang=en opens the English LP', () => {
  assert.match(read('../app/resolute/lp/page.tsx'), /if \(\(await searchParams\)\.lang === "en"\) redirect\("\/resolute\/lp\/en"\);/);
});

test('owner review sign-in is in Japanese', () => {
  assert.match(read('../app/resolute/review/page.tsx'), /<ClerkProvider appearance=\{clerkAppearance\} localization=\{resoluteClerkJa\}/);
  assert.equal(resoluteClerkJa.locale, 'ja-JP');
  assert.equal(resoluteClerkJa.formFieldInputPlaceholder__emailAddress, '例：name@example.com');
  assert.ok(JSON.stringify(resoluteClerkJa) && !Object.values(resoluteClerkJa).some(v => typeof v === 'function'));
});
