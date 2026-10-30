import * as accountReturn from "../lib/research/account-return.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/research/account/screen.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText;
const compiledModule = { exports: {} };
let language = "ja";
let authLoaded = true;
const links = [];
new Function("require", "module", "exports", compiled)(id => {
  if (id === "@/lib/research/account-return") return accountReturn;
  if (id.endsWith(".module.css")) return { default: {} };
  if (id === "@clerk/nextjs") return {
    useAuth: () => ({ isLoaded: authLoaded, isSignedIn: true }),
    SignIn: () => createElement("p", null, "Sign in"),
    SignUp: () => createElement("p", null, "Sign up"),
    SignOutButton: ({ children }) => children,
  };
  if (id === "next/link") return { default: ({ children, prefetch, ...props }) => {
    links.push({ ...props, prefetch });
    return createElement("a", props, children);
  } };
  if (id === "../research-tool-shell") return { default: ({ children }) => children };
  if (id === "../use-research-language") return { useResearchLanguage: () => [language, () => {}] };
  if (id === "@/lib/research/member-recovery") return { recoverMember: () => { throw Error("Unexpected effect during server render"); } };
  if (id === "../identity-provider") return { useIdentityRefresh: () => async () => {} };
  if (id === "./account-view") return { default: ({ member }) => createElement("p", null, `account-view:${member.ownerMode}:${member.isAdmin}`) };
  return require(id);
}, compiledModule, compiledModule.exports);
const AccountScreen = compiledModule.exports.default;
function render(member, lang = "ja", loaded = true) {
  language = lang; authLoaded = loaded; links.length = 0;
  const html = renderToStaticMarkup(createElement(AccountScreen, {
    status: member.status, plan: member.plan ?? "free", initialMember: member,
  }));
  return { html, statusLinks: links.filter(link => link.href === "/research/review") };
}
const owner = { status: "signed-in", plan: "pro", isAdmin: true, ownerMode: true, canTest: true, testing: false };
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("a signed-in member reaches the redesigned account view; the owner menu links live there", () => {
  assert.match(render(owner).html, /account-view:true:true/);
  assert.match(render({ ...owner, isAdmin: false, ownerMode: false, plan: "free" }).html, /account-view:false:false/);
  const view = read("../app/research/account/account-view.tsx");
  // The owner-only menu (members and delivery status) is built only for the owner.
  assert.match(view, /const ownerMenu = owner && <>/);
  assert.match(view, /href: "\/research\/account\/members"/);
  assert.match(view, /href: "\/research\/account\/delivery"/);
});

test("signed-out, unavailable and loading states never render the account view or owner links", () => {
  for (const member of [{ ...owner, status: "signed-out" }, { ...owner, status: "unavailable" }, { ...owner, status: "loading" }]) {
    for (const loaded of [true, false]) assert.doesNotMatch(render(member, "ja", loaded).html, /account-view/);
  }
});

test("owner pages open only for a verified owner and the delivery page prefetches nothing", () => {
  const gate = read("../app/research/account/owner-gate.tsx");
  assert.match(gate, /value\.status === "signed-in" && value\.isAdmin === true/);
  assert.match(gate, /state === "owner" && children/);
  assert.match(read("../app/research/account/account-view.tsx"), /prefetch=\{false\}/);
});
