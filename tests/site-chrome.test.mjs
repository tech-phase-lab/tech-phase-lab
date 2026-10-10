import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { isOwnerAccount, resolveAdmin, OWNER_ACCOUNT_ID } from "../lib/membership/entitlements.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
async function load(path, replacements = []) {
  let source = read(path);
  for (const [from, to] of replacements) source = source.replace(from, to);
  return import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64"));
}

test("only the approved owner account gets the Owner label, never an admin role", () => {
  assert.equal(isOwnerAccount(OWNER_ACCOUNT_ID), true);
  for (const id of ["user_other", "", null, undefined, OWNER_ACCOUNT_ID + "x", OWNER_ACCOUNT_ID.toLowerCase()]) assert.equal(isOwnerAccount(id), false);
  assert.equal(resolveAdmin("user_other", { role: "admin" }), true);
  assert.equal(isOwnerAccount("user_other"), false);
  const server = read("lib/membership/server.ts");
  assert.match(server, /ownerAccount: isOwnerAccount\(userId\) && testPlan === null/);
  const route = read("app/api/research/member/route.ts");
  assert.match(route, /ownerAccount: "ownerAccount" in membership && membership.ownerAccount === true/);
  const provider = read("app/research/member-display-provider.tsx");
  assert.match(provider, /setOwnerAccount\(member\.status === "signed-in" && member\.ownerAccount === true\)/);
});

test("header label follows the plan in both languages; signed-out reads FREE", async () => {
  const header = read("app/research/site-header.tsx");
  const fn = header.slice(header.indexOf("export function planLabel"), header.indexOf("export function reloadPage"));
  const { planLabel } = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(fn)).toString("base64"));
  assert.equal(planLabel("ja", "pro", true), "運営者");
  assert.equal(planLabel("en", "pro", true), "Owner");
  assert.equal(planLabel("ja", "pro", false), "PRO");
  assert.equal(planLabel("en", "pro", false), "PRO");
  assert.equal(planLabel("ja", "free", false), "FREE");
  assert.equal(planLabel("en", null, false), "FREE");
  assert.match(header, /<span>RESEARCH ·<\/span><span className=\{styles.planName\}>\{planLabel\(lang, plan, ownerAccount\)\}<\/span>/);
  // PRO members and the owner see the gold reload ring where FREE readers see the gold PRO button.
  assert.match(header, /const member = ownerAccount \|\| plan === "pro";/);
  assert.match(header, /className=\{`\$\{styles\.ring\}/);
  assert.match(header, /aria-label=\{ja \? "PROを見る" : "See PRO"\}/);
  // Order on the right: JA/EN, plan button, menu.
  assert.ok(header.indexOf(">JA</button>") < header.indexOf("styles.ring") && header.indexOf("styles.pro}") < header.indexOf("aria-controls=\"site-menu\""));
  const css = read("app/research/site-header.module.css");
  // The ring only glows softly; the arrow turns once when pressed (no orbit or countdown).
  assert.match(css, /\.spinOnce > svg:last-child \{ animation:spin \.7s cubic-bezier\(\.4,0,\.2,1\) 1; \}/);
  assert.doesNotMatch(css, /stroke-dashoffset|orbit/);
  // Reload is also in the menu for every reader.
  assert.match(header, /ja \? "再読み込み" : "Refresh"\}<\/button>/);
});

test("first visit follows the browser language; a saved choice wins", async () => {
  const { browserLanguage } = await load("app/research/use-research-language.ts", [[/^"use client";/, ""], [/import \{ useEffect, useSyncExternalStore \} from "react";/, "const useEffect=()=>{},useSyncExternalStore=()=>{};"]]);
  assert.equal(browserLanguage(["ja-JP", "en-US"]), "ja");
  assert.equal(browserLanguage(["en-US", "ja"]), "en");
  assert.equal(browserLanguage(["fr-FR"]), "en");
  assert.equal(browserLanguage([]), "ja");
  const source = read("app/research/use-research-language.ts");
  assert.ok(source.indexOf("localStorage.getItem(key)") < source.indexOf("browserLanguage(navigator.languages"));
});

test("unread alerts count only listed, translated, published stories", async () => {
  const { alertItems } = await import("../lib/research/alert-items.ts");
  const now = Date.parse("2026-10-08T12:00:00Z");
  const base = { url: "https://www.example.com/a", publisher: "Micron", tickers: ["MU"], observedAt: "2026-10-08T11:59:00Z" };
  const feed = { officialUpdates: [
    { ...base, id: "1", title: "Micron reports Q4 results", translationJa: "マイクロン、決算を発表", publishedAt: "2026-10-08T11:00:00Z" },
    { ...base, id: "2", title: "Micron reports Q4 results", publishedAt: "2026-10-08T11:30:00Z" },
    { ...base, id: "3", title: "Micron reports Q4 results", translationJa: "マイクロン決算" },
    { ...base, id: "4", title: "Next-Generation Networking", translationJa: "次世代ネットワーク", publishedAt: "2026-10-08T11:40:00Z", tickers: ["ANET"], publisher: "Arista Networks" },
    { ...base, id: "5", title: "Micron reports Q4 results", translationJa: "未来", publishedAt: "2026-10-09T00:00:00Z" },
  ], marketUpdates: [{ id: "m1", titleJa: "米国債", publishedAt: "2026-10-08T10:00:00Z" }] };
  const items = alertItems(feed, now);
  assert.deepEqual(items.map(item => item.id), ["official:1", "market:m1"]);
  assert.deepEqual(alertItems(null, now), []);
  const hook = read("app/research/use-alerts-unread.ts");
  assert.match(hook, /if \(seen === null \|\| onAlertsPage\) \{ writeSeen\(Date\.now\(\)\); setUnread\(false\); return; \}/);
  assert.match(hook, /filter\(item => item\.at > seen\)/);
  assert.match(hook, /localStorage\.setItem\(REASON_KEY/);
});

test("bottom bar: five items in order, bilingual labels, raised search, unread dot, reduced motion", () => {
  const nav = read("app/research/bottom-nav.tsx");
  const order = ["ホーム", "速報", "銘柄検索", "お気に入り", "マーケット"].map(label => nav.indexOf(`"${label}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  for (const [ja, en] of [["ホーム", "Home"], ["速報", "Alerts"], ["銘柄検索", "Search"], ["お気に入り", "Watchlist"], ["マーケット", "Markets"]]) {
    assert.match(nav, new RegExp(`ja \\? "${ja}" : "${en}"`));
  }
  assert.match(nav, /tab\.key === "alerts" && unread && <span className=\{styles\.live\}/);
  assert.doesNotMatch(nav, /badge/);
  const css = read("app/research/bottom-nav.module.css");
  assert.match(css, /bottom:calc\(10px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /prefers-reduced-motion:reduce\) \{\n  \.glow, \.bar a, \.orb \{ transition:none !important; \}\n  \.live::after \{ animation:none !important; \}/);
  assert.match(css, /\.bar a\[aria-current="page"\] \.star \{ fill:rgba\(143,227,192,\.22\)/);
});

test("menu follows the plan sample: cards, two short buttons, Research/Guides, English labels", () => {
  const menu = read("app/research/site-header.tsx");
  for (const [ja, en] of [["PROで、もっと深く", "Go deeper with PRO"], ["案内を見る", "Learn more"], ["プランの管理", "Manage plan"],
    ["すべての機能が使えます", "All features unlocked"], ["運営者　全機能", "Owner · Full access"], ["アカウント", "Account"],
    ["スマホ通知", "Mobile alerts"], ["再読み込み", "Refresh"], ["監視22銘柄リスト", "22 Tracked Stocks"],
    ["決算・経済指標", "Earnings & Indicators"], ["銘柄比較 PRO", "Compare · PRO"]]) {
    assert.ok(menu.includes(`"${ja}" : "${en}"`), ja);
  }
  // Manage plan opens the account page; paid buttons are Account + Mobile alerts, free ones Refresh + Account.
  assert.match(menu, /className=\{styles\.manage\} href="\/research\/account"/);
  assert.match(menu, /href="\/research\/notifications"/);
  // The three research items carry no PRO tag or lock.
  const research = menu.slice(menu.indexOf('{ja ? "リサーチ" : "Research"}'), menu.indexOf('{ja ? "ガイド" : "Guides"}'));
  assert.doesNotMatch(research, /lock|PRO|tag/);
  // The sample has no PRO group under the two buttons (owner, Oct 8).
  assert.doesNotMatch(menu, /proHead|item\("\/research\/(compare|notes|qa|weekly)"/);
  assert.doesNotMatch(menu, /: `銘柄比較 PRO, /);
  const css = read("app/research/site-header.module.css");
  assert.match(css, /border-radius:22px 22px 0 0/);
  // ".app button { font:inherit }" must not enlarge the free PRO button past the sample's 12px.
  assert.match(css, /\.tools \.pro \{\n[^}]*font-size:11px/);
  // The sheet sits above the bottom bar (z-index 60) so a swipe anywhere scrolls it.
  assert.match(css, /\.backdrop \{ position:fixed; inset:0; z-index:61;/);
  assert.match(css, /position:fixed; z-index:62; left:0; right:0; bottom:0;/);
  // Desktop: a home button left of JA/EN.
  assert.ok(menu.indexOf('aria-label={ja ? "ホームへ" : "Home"}') < menu.indexOf('aria-label={ja ? "言語" : "Language"}'));
  assert.match(css, /\.home \{ display:none; \}/);
  assert.match(css, /\.home \{ display:grid; \}/);
  // Paid buttons: Mobile alerts on the left, Account on the right (owner, Oct 8).
  const tiles = menu.slice(menu.indexOf("{member\n          ? <>"));
  assert.ok(tiles.indexOf('href="/research/notifications"') < tiles.indexOf('href="/research/account"'));
});

test("phone menu follows the finger and closes when pulled down", () => {
  const menu = read("app/research/site-header.tsx");
  assert.match(menu, /if \(dy > 0 && atTop\) place\(dy, false\);/);
  assert.match(menu, /else if \(dy < 0 && atEnd\) place\(Math\.max\(dy \* 0\.25, -28\), false\);/);
  assert.match(menu, /if \(offset > 90\) \{ place\(window\.innerHeight, true\); window\.setTimeout\(onClose, 180\); \}/);
});

test("news list leaves out items with no source time", () => {
  const panel = read("app/research/news/general-news-panel.tsx");
  assert.match(panel, /informativeOfficial\(item\) && officialTime\(item\)\.kind !== "observed"/);
});

test("news list sorts by the time each card shows, newest first", () => {
  const panel = read("app/research/news/general-news-panel.tsx");
  assert.match(panel, /shown = clockTime\(time\.at, time\.kind, item\.observedAt\);/);
  assert.match(panel, /at: shown\.kind === "date" \? `\$\{shown\.at\}T00:00:00Z` : shown\.at/);
  assert.match(panel, /const publication = update\.publication,/);
  assert.match(panel, /\.sort\(\(a, b\) => Date\.parse\(b\.publishedAt\) - Date\.parse\(a\.publishedAt\)\)/);
});
