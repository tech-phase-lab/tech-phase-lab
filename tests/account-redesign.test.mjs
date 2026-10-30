import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, stubs = {}) {
  const out = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", out)(id => id.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : id in stubs ? stubs[id] : require(id), mod, mod.exports);
  return mod.exports;
}
const avatars = load("../app/research/account/avatars.ts");
const sheets = load("../app/research/account/account-sheets.tsx", {
  "next/link": { default: ({ children, ...props }) => createElement("a", props, children) },
  "@/lib/membership/billing-client": { billingRequest: async () => { throw Error("not called"); }, sandboxApproval: () => "" },
  "./avatars": avatars,
});

test("the icon sheet offers the initial and exactly 23 distinct emoji tiles, no photo upload", () => {
  assert.equal(avatars.TILES.length, 23);
  assert.equal(new Set(avatars.TILES.map(tile => tile.id)).size, 23);
  const html = renderToStaticMarkup(createElement(sheets.AvatarSheet, { ja: true, initial: "ゆ", current: "initial", onSave: async () => {}, onClose: () => {} }));
  assert.equal((html.match(/aria-pressed/g) ?? []).length, 24);
  assert.doesNotMatch(html, /type="file"/);
});

test("upgrade sheet: the consent starts off and the PayPal button is dimmed until it is ticked", () => {
  const html = renderToStaticMarkup(createElement(sheets.UpgradeSheet, { ja: true, mode: "live", refresh: async () => {}, onClose: () => {} }));
  assert.match(html, /type="checkbox"/);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>PayPalへ進む<\/button>/);
  assert.match(html, /月額料金/); assert.match(html, /¥2,980/); assert.match(html, /毎月自動で更新/);
});

test("with billing closed the upgrade sheet says so and cannot proceed", () => {
  const html = renderToStaticMarkup(createElement(sheets.UpgradeSheet, { ja: true, mode: null, refresh: async () => {}, onClose: () => {} }));
  assert.match(html, /受付は、現在停止中/);
  assert.match(html, /disabled=""[^>]*>PayPalへ進む/);
});

test("account deletion stays locked while the renewal is not confirmed stopped, and warns about remaining PRO time after", () => {
  const props = { ja: true, lockedReason: "PROの契約が有効です。先に、自動更新の停止を確認してください。", onRecheck: () => {}, onDelete: async () => {}, onClose: () => {} };
  const locked = renderToStaticMarkup(createElement(sheets.DeleteSheet, { ...props, locked: true, proUntil: null }));
  assert.match(locked, /PROの契約が有効です/);
  assert.match(locked, /契約を確認する/);
  assert.match(locked, /disabled=""[^>]*>アカウントを削除する/);
  const open = renderToStaticMarkup(createElement(sheets.DeleteSheet, { ...props, locked: false, proUntil: "2026年11月30日" }));
  assert.match(open, /PROは2026年11月30日まで利用できます。削除すると、その権利も失われます。/);
  assert.doesNotMatch(open, /disabled=""[^>]*>アカウントを削除する/);
});

test("dates and contract values are shown only from server data; unknown contracts offer a recheck", () => {
  const view = readFileSync(new URL("../app/research/account/account-view.tsx", import.meta.url), "utf8");
  assert.match(view, /契約の状態を確認できませんでした。/);
  assert.match(view, />\{t\("再確認", "Check again"\)\}</);
  assert.match(view, /Number\.isFinite\(ms\) && ms > 0/);
  assert.doesNotMatch(view, /次回請求日/); // no next-billing date comes from the server yet
  assert.match(view, /停止済み|Renewal stopped/);
  assert.doesNotMatch(view, /解約済み/);
});
