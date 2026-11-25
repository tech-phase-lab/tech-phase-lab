import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID } from "../lib/membership/entitlements.ts";
import { proPageAllowed } from "../lib/membership/pro-access.ts";
import { companyFreeHref, companyHref } from "../lib/research/company-href.ts";
import { carriedConsent, withConsent, CARRIED_CONSENT_MAX_AGE } from "../lib/legal/consent.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NOW = Date.parse("2026-11-25T06:00:00Z");

test("監視22銘柄 pages: PRO and both owner accounts only (owner, Nov 25)", () => {
  const later = NOW + 3_600_000;
  assert.equal(proPageAllowed({ status: "signed-out", plan: "free" }, NOW), false);
  assert.equal(proPageAllowed({ status: "unavailable", plan: "free" }, NOW), false);
  assert.equal(proPageAllowed({ status: "signed-in", plan: "free", accessExpiresAt: 0, userId: "user_free" }, NOW), false);
  assert.equal(proPageAllowed({ status: "signed-in", plan: "pro", accessExpiresAt: NOW - 1, userId: "user_lapsed" }, NOW), false);
  assert.equal(proPageAllowed({ status: "signed-in", plan: "pro", accessExpiresAt: later, userId: "user_pro" }, NOW), true);
  // Owner accounts always keep access, also while trying the app as FREE (AGENTS.md: operator access).
  for (const userId of [OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID]) {
    assert.equal(proPageAllowed({ status: "signed-in", plan: "free", accessExpiresAt: 0, userId }, NOW), true, userId);
    assert.equal(proPageAllowed({ status: "signed-in", plan: "pro", accessExpiresAt: later, userId }, NOW), true, userId);
    assert.equal(proPageAllowed({ status: "signed-out", plan: "free", userId }, NOW), false, userId);
  }
});

test("the gate runs on the server first and redirects to the stock's FREE page", () => {
  const helper = read("lib/membership/pro-page.ts");
  assert.match(helper, /^import "server-only";/);
  assert.match(helper, /await connection\(\);\s*const member: PageMember = await getMembership\(\)\.catch/);
  assert.match(helper, /if \(!proPageAllowed\(member\)\) redirect\(fallback\);/);
  const company = read("app/research/companies/[ticker]/page.tsx");
  assert.match(company, /Promise<\{ ticker: string \}> \}\) \{\s*const \{ ticker \} = await params;\s*\/\/[^\n]*\n\s*const verified = await requireProPage\(companyFreeHref\(ticker\)\);/);
  assert.doesNotMatch(company, /^"use client"/);
  const directory = read("app/research/companies/page.tsx");
  assert.match(directory, /export default async function CompaniesPage\(\) \{\s*await requireProPage\(companyFreeHref\(\)\);/);
  assert.equal(companyFreeHref("NVDA"), "/research/quote/NVDA?from=search");
  assert.equal(companyFreeHref(), "/research/stocks");
  assert.equal(companyHref("MU", true), "/research/companies/MU");
  assert.equal(companyHref("MU", false), "/research/quote/MU?from=search");
});

test("no FREE-visible link goes straight to /research/companies/<ticker>", () => {
  assert.match(read("app/research/companies/company-directory.tsx"), /href=\{companyHref\(company\.ticker,pro\)\}/);
  assert.match(read("app/research/research-dashboard.tsx"), /href=\{companyHref\(active\.ticker, proReader\)\}/);
  for (const path of ["app/research/companies/company-directory.tsx", "app/research/research-dashboard.tsx"])
    assert.doesNotMatch(read(path), /href=\{`\/research\/companies\/\$\{/, path);
});

test("Columns / notes: 🔒 only per post, one PRO line for the list", () => {
  const source = read("app/research/columns/columns.tsx");
  assert.doesNotMatch(source, /この先の本文はPRO会員向けです/);
  assert.match(source, /<aside className=\{styles\.postLock\}[^>]*><span aria-hidden="true">🔒<\/span><\/aside>/);
  assert.equal((source.match(/ログイン・会員情報/g) ?? []).length, 1);
  assert.match(source, /shown\.access !== "pro" && shown\.items\.some\([^)]*\) && <p className=\{styles\.listLock\}>/);
});

test("Ask Rizel: no subtitle in the FREE view, short lock line", () => {
  const source = read("app/research/qa/questions.tsx");
  assert.match(source, /: state !== "ready" \? ""/);
  assert.match(source, /質問の投稿・閲覧はPRO会員限定です。/);
  assert.doesNotMatch(source, /すべての質問への回答はお約束していません/);
});

test("relationship maps: one closed 「出典」 at the bottom, short footer, no 3-steps line, no overlapping sample box", () => {
  const stock = read("app/research/stocks/stock-chain-map.tsx"), network = read("app/research/stocks/chain-map.tsx");
  for (const source of [stock, network]) {
    assert.doesNotMatch(source, /出典・引用・発表日/);
    assert.match(source, /<SourceList /);
  }
  assert.doesNotMatch(stock, /3段先以降/);
  assert.match(stock, /ja: "公式資料で確認できた関係のみ。投資判断を勧めるものではありません。"/);
  assert.ok(stock.indexOf("<SourceList") > stock.indexOf("CHAIN_NOTE.ja, CHAIN_NOTE.en"));
  assert.match(network, /t\(CHAIN_NOTE\.ja,CHAIN_NOTE\.en\)/);
  // The 無料サンプル box no longer pulls up over the footer line above it.
  const badge = read("app/research/stocks/map-lock.module.css").match(/\.badge \{[^}]*\}/)[0];
  assert.doesNotMatch(badge, /margin:-/);
});

test("PRO card with only a link: the consent tick sits right above it and the time travels to the purchase screen", () => {
  const card = read("app/research/pro-offer-card.tsx");
  const linkPath = card.slice(card.indexOf(": href && !disabled ?"));
  assert.match(linkPath, /^: href && !disabled \? <><ConsentCheck en=\{!ja\} consent=\{consent\} \/>\s*<Link className=\{styles\.paypal\} href=\{consent\.agreedAt \? withConsent\(href, consent\.agreedAt\) : href\}/);
  assert.match(linkPath, /const at = consent\.require\(\);\s*if \(!at\) \{ event\.preventDefault\(\); return; \}/);
  assert.match(linkPath, /<\/Link><ConsentError en=\{!ja\} consent=\{consent\} \/><\/>/);
  // The account page's card (onSubscribe) starts ticked with the carried time; its button sends that time to the billing API.
  assert.match(card, /carriedConsent\(new URLSearchParams\(window\.location\.search\)\.get\("consentAt"\)\) \?\? carriedConsent\(stored\)/);
  assert.match(card, /setTimeout\(\(\) => restore\(at\), 0\)/);
  assert.match(read("app/research/plan-cards.tsx"), /<ProOfferCard ja=\{ja\} href="\/research\/account\?upgrade=1">/);

  const at = new Date(NOW - 60_000).toISOString();
  assert.equal(carriedConsent(at, NOW), at);
  assert.equal(carriedConsent(new Date(NOW - CARRIED_CONSENT_MAX_AGE - 1).toISOString(), NOW), null);
  assert.equal(carriedConsent(new Date(NOW + 3_600_000).toISOString(), NOW), null);
  for (const bad of [null, "", "yesterday", "2026-11-25", 42]) assert.equal(carriedConsent(bad, NOW), null);
  assert.equal(withConsent("/research/account?upgrade=1", at), `/research/account?upgrade=1&consentAt=${encodeURIComponent(at)}`);
  assert.equal(withConsent("/research/account", at), `/research/account?consentAt=${encodeURIComponent(at)}`);
});

test("every PRO / RESOLUTE purchase button has the consent tick right above it", () => {
  for (const path of ["app/research/pro-offer-card.tsx", "app/research/account/account-sheets.tsx", "app/research/account/billing/screen.tsx",
    "app/resolute/checkout/screen.tsx", "app/resolute/checkout/live-screen.tsx", "app/resolute/lp/buy-button.tsx"]) {
    const source = read(path);
    const ticks = (source.match(/<ConsentCheck /g) ?? []).length, errors = (source.match(/<ConsentError /g) ?? []).length;
    assert.ok(ticks >= 1 && ticks === errors, `${path}: ${ticks} ticks, ${errors} error lines`);
  }
});
