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
  assert.match(header, /RESEARCH · \{planLabel\(lang, plan, ownerAccount\)\}/);
  // PRO members and the owner see 更新 where FREE readers see the gold PRO button.
  assert.match(header, /const member = ownerAccount \|\| plan === "pro";/);
  assert.match(header, /ja \? "更新" : "Refresh"/);
  assert.match(header, /aria-label=\{ja \? "PROを見る" : "See PRO"\}/);
  // Order on the right: JA/EN, plan button, menu.
  assert.ok(header.indexOf(">JA</button>") < header.indexOf("styles.refresh") && header.indexOf("styles.pro}") < header.indexOf("styles.ico}"));
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

test("unread alerts compare the newest article with the last visit", async () => {
  const { latestAlertTime } = await load("app/research/use-alerts-unread.ts", [[/^"use client";/, ""], [/import \{ useEffect, useState \} from "react";/, "const useEffect=()=>{},useState=()=>[];"]]);
  const payload = { officialUpdates: [{ publishedAt: "2026-10-08T01:00:00Z" }, { observedAt: "2026-10-08T03:00:00Z" }],
    resultBriefs: [{ publishedAt: "2026-10-08T02:00:00Z" }], marketUpdates: "bad", items: [null, { publishedAt: "nonsense" }] };
  assert.equal(latestAlertTime(payload), Date.parse("2026-10-08T03:00:00Z"));
  assert.equal(latestAlertTime(null), 0);
  const source = read("app/research/use-alerts-unread.ts");
  assert.match(source, /setUnread\(latest > seen\)/);
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
