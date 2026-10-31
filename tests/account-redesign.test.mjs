import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { accountIcons } from "../lib/account/profile.ts";
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

const data = load("../app/research/account/account-data.ts");
const profileLib = load("../lib/account/profile.ts");

test("icon ids are exactly the ones the profile API accepts (initial + 23)", () => {
  assert.deepEqual([avatars.INITIAL, ...avatars.TILES.map(tile => tile.id)], profileLib.accountIcons);
});

test("the icon sheet offers the initial and exactly 23 distinct emoji tiles, no photo upload", () => {
  assert.equal(avatars.TILES.length, 23);
  assert.deepEqual([avatars.INITIAL, ...avatars.TILES.map(tile => tile.id)], [...accountIcons]);
  assert.equal(avatars.tileById("🚀"), undefined);
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

test("a contract is drawn only when every printed value came from the server", () => {
  const base = { accessPlan: "pro", verification: "verified", autoRenew: true, amount: "2980.00", currency: "JPY", nextBillingAt: "2026-11-30T00:00:00.000Z", accessExpiresAt: "2026-11-30T00:00:00.000Z", unavailableFields: [] };
  assert.equal(data.contractComplete(data.readContract({ ...base, status: "active" })), true);
  assert.equal(data.contractComplete(data.readContract({ ...base, status: "active", nextBillingAt: null })), false);
  assert.equal(data.contractComplete(data.readContract({ ...base, status: "active", amount: null })), false);
  assert.equal(data.contractComplete(data.readContract({ ...base, status: "renewal-stopped", autoRenew: false, nextBillingAt: null })), true);
  assert.equal(data.contractComplete(data.readContract({ ...base, status: "renewal-stopped", accessExpiresAt: null })), false);
  assert.equal(data.contractComplete(data.readContract({ ...base, status: null, verification: "unavailable" })), false);
  assert.equal(data.contractComplete(data.readContract({ ...base, status: "none", accessPlan: "free", amount: null, currency: null })), true);
  assert.throws(() => data.readContract({ verification: "nope", status: null }));
  assert.equal(data.formatDay("not a date", true), null);
  assert.equal(data.formatAmount("2980.00", "JPY"), "¥2,980");
});

test("account screen: unknown contract offers a recheck, deletion is only a notice, nothing is guessed or wired to the legacy export", () => {
  const view = readFileSync(new URL("../app/research/account/account-view.tsx", import.meta.url), "utf8");
  assert.match(view, /契約の状態を確認できませんでした。/);
  assert.match(view, /t\("再確認", "Check again"\)/);
  assert.match(view, /現在、この画面からは削除できません。お問い合わせください。/);
  assert.doesNotMatch(view, /user\.delete|DeleteSheet|setSheet\("delete"\)/);
  assert.doesNotMatch(view, /解約済み/);
  assert.match(view, /\/api\/research\/account\/profile/);
  assert.match(view, /\/api\/research\/account\/contract/);
  for (const file of ["members/screen.tsx", "delivery/screen.tsx", "account-view.tsx", "account-data.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(`../app/research/account/${file}`, import.meta.url), "utf8"), /member\/export/);
  }
});

test("members page pages through the cursor and downloads only what is shown; delivery never turns unknown into 0", () => {
  const members = readFileSync(new URL("../app/research/account/members/screen.tsx", import.meta.url), "utf8");
  assert.match(members, /api\/research\/account\/admin\/members/);
  assert.match(members, /もっと見る/);
  assert.match(members, /表示中の一覧をダウンロード/);
  assert.match(members, /items\.map\(r => \[r\.id/);
  const delivery = readFileSync(new URL("../app/research/account/delivery/screen.tsx", import.meta.url), "utf8");
  assert.match(delivery, /送信受理/);
  assert.match(delivery, /typeof n === "number" \? .* : "—"/);
  assert.doesNotMatch(delivery, /\?\? 0/);
});

test("the owner's address is masked on screen (am***@gmail.com); view-mode switching does not reload the page", () => {
  assert.equal(data.maskEmail("amweb.0815@gmail.com"), "am***@gmail.com");
  assert.equal(data.maskEmail("a@x.jp"), "a***@x.jp");
  assert.equal(data.maskEmail(""), "");
  const view = readFileSync(new URL("../app/research/account/account-view.tsx", import.meta.url), "utf8");
  assert.match(view, /shownEmail = owner \? maskEmail\(email\) : email/);
  assert.doesNotMatch(view, /location\.reload/);
  assert.match(view, /membership-changed/);
  assert.match(readFileSync(new URL("../app/research/account/members/screen.tsx", import.meta.url), "utf8"), /r\.plan === "owner" && r\.email \? maskEmail/);
});

test('missing security flags are unavailable, never an implicit MFA-off state',()=>{
 const p={displayName:'Member',icon:'initial',plan:'free',passwordEnabled:false,twoFactorEnabled:false};
 assert.equal(data.readProfile(p).twoFactorEnabled,false);
 assert.equal(data.readProfile({...p,twoFactorEnabled:true}).twoFactorEnabled,true);
 for(const key of ['passwordEnabled','twoFactorEnabled']){
  const incomplete={...p};delete incomplete[key];assert.throws(()=>data.readProfile(incomplete));
 }
});

function renderAccount({owner=false,profile={state:'loading'},contract={state:'loading'},resolute={state:'loading'}}={}) {
 let index=0;
 const react=require('react');
 const view=load('../app/research/account/account-view.tsx',{
  react:{...react,useEffect:()=>{},useCallback:fn=>fn,useState:initial=>{
   const value=({3:profile,4:contract,5:resolute})[index++]??initial;return [value,()=>{}];
  }},
  'next/link':{default:({children,...props})=>createElement('a',props,children)},
  'next/navigation':{useRouter:()=>({replace:()=>{}})},
  '@clerk/nextjs':{useClerk:()=>({})},
  '../identity-provider':{useIdentityRefresh:()=>()=>{}},
  './crown':{default:()=>null},'./avatars':avatars,'./account-sheets':sheets,'./account-data':data,
 });
 return renderToStaticMarkup(createElement(view.default,{ja:true,member:{status:'signed-in',plan:owner?'pro':'free',isAdmin:owner,ownerMode:owner,testing:false,canTest:false},billingAvailable:true,upgradeFirst:false,onRecheck:()=>{}}));
}
test('rendered owner account reflects real contract evidence independently of owner access',()=>{
 const base={verification:'verified',autoRenew:false,accessPlan:'free',amount:null,currency:null,nextBillingAt:null,accessExpiresAt:null,unavailableFields:[]};
 for(const [status,label] of [['none','有料契約なし'],['active','有料契約あり'],['renewal-stopped','自動更新停止済み']]){
  const html=renderAccount({owner:true,contract:{state:'ok',value:{...base,status}}});
  assert.match(html,new RegExp([...label].join('\\s*'))); /* the badge may break the label over two lines */ if(status!=='none')assert.doesNotMatch(html,/有料契約\s*なし/);
 }
 const unknown=renderAccount({owner:true,contract:{state:'unknown'}});
 assert.doesNotMatch(unknown,/契約を確認\s*できません|契約を確認中|有料契約\s*なし|有料契約を確認/); /* the owner is one person: unverified means nothing is written */
});
test('rendered account does not show MFA off or silently hide unavailable purchases',()=>{
 const html=renderAccount({profile:{state:'error'},resolute:{state:'unknown'}});
 assert.match(html,/2段階認証/);assert.match(html,/確認できません/);assert.doesNotMatch(html,/>オフ</);
 assert.match(html,/購入状況を確認できませんでした/);
});

test("returning to the account page refreshes silently: no skeleton, an open sheet keeps its input", () => {
  const view = readFileSync(new URL("../app/research/account/account-view.tsx", import.meta.url), "utf8");
  const resume = view.slice(view.indexOf("const resume = () =>"), view.indexOf('window.addEventListener("focus", resume)'));
  assert.ok(resume.includes("setTick"));
  assert.doesNotMatch(resume, /setProfile|setContract|setResolute/);
  assert.match(view, /setProfile\(prev => prev\.state === "ok" \? prev : \{ state: "error" \}\)/);
  assert.match(view, /owner && !preview && c\?\.verification === "verified" && \(c\.status === "active" \|\| c\.status === "renewal-stopped"\)/);
});
