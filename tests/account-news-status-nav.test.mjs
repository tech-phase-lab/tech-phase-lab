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
  if (id === "./preview-controls") return { default: () => null };
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

test("existing owner account links to news delivery status without route prefetch", () => {
  for (const member of [owner, { ...owner, plan: "free", ownerMode: false, testing: true }]) {
    const { html, statusLinks } = render(member);
    assert.match(html, /<a href="\/research\/review">ニュース配信状況<\/a>/);
    assert.equal(statusLinks.length, 1);
    assert.equal(statusLinks[0].prefetch, false);
    assert.match(html, /href="\/research\/write"/);
    assert.match(html, /href="\/api\/research\/member\/export"/);
  }
  assert.match(render(owner, "en").html, /News delivery status/);
});

test("signed-out, unavailable, loading, FREE, PRO, and role-loss states do not expose the owner link", () => {
  const members = [
    { ...owner, status: "signed-out" },
    { ...owner, status: "unavailable" },
    { ...owner, status: "loading" },
    { ...owner, isAdmin: false, plan: "free" },
    { ...owner, isAdmin: false, plan: "pro" },
    { ...owner, isAdmin: "true" },
    { ...owner, isAdmin: undefined },
  ];
  for (const member of members) {
    for (const loaded of [true, false]) {
      const { html, statusLinks } = render(member, "ja", loaded);
      assert.equal(statusLinks.length, 0, JSON.stringify({ member, loaded }));
      assert.doesNotMatch(html, /ニュース配信状況|href="\/research\/review"/);
    }
  }
  assert.equal(render(owner).statusLinks.length, 1);
  assert.equal(render({ ...owner, isAdmin: false }).statusLinks.length, 0);
});
