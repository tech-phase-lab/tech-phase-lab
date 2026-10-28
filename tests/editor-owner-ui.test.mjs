import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const directory = new URL("../app/research/review/", import.meta.url);
const files = ["review-dashboard.tsx", "signals-panel.tsx", "official-research-panel.tsx", "news-panel.tsx"];
let owner = false;
const loaded = new Map();
function load(name) {
  if (loaded.has(name)) return loaded.get(name).exports;
  const source = readFileSync(new URL(name, directory), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiledModule = { exports: {} }; loaded.set(name, compiledModule);
  new Function("require", "module", "exports", compiled)(id => {
    if (id.endsWith(".module.css")) return { default: {} };
    if (id === "../member-display-provider") return { useResearchOwner: () => owner };
    if (id === "@/lib/research/annual-draft-evidence") return { annualReviewPreflight: () => ({ ready: false, blockers: [] }) };
    if (id === "@/lib/research/x-target-preview") return require("../lib/research/x-target-preview.ts");
    if (id.startsWith("./")) return load(id.slice(2) + ".tsx");
    return require(id);
  }, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const Dashboard = load("review-dashboard.tsx").default;
const button = (html, label) => html.match(new RegExp(`<button([^>]*)>${label}</button>`))?.[1];

test("owner refresh and new-tab rendering enables news controls without a token and preserves the annual gate", () => {
  owner = true;
  for (let i = 0; i < 2; i++) {
    const html = renderToStaticMarkup(Dashboard());
    assert.match(html, /運営者としてログインしています/);
    assert.match(html, /アカウント・ログアウト/);
    for (const label of ["レビューキューを読み込む", "取得状況を読み込む", "通常ニュースを読み込む", "取得・記事の診断を読み込む"]) {
      const attributes = button(html, label);
      assert.notEqual(attributes, undefined, label);
      assert.doesNotMatch(attributes, /disabled/, label);
    }
    assert.match(button(html, "年次報告書を開く"), /disabled/);
    assert.match(html, /<details><summary>年次報告書・従来のトークン認証/);
    assert.doesNotMatch(html, /Bearer |RESEARCH_EDITOR_TOKEN|synthetic-private/);
  }
});

test("logout and owner-role loss remount all private review state and disable unauthenticated reads", () => {
  owner = true; const authenticated = Dashboard();
  owner = false; const unauthenticated = Dashboard();
  assert.equal(authenticated.type, unauthenticated.type);
  assert.notEqual(authenticated.key, unauthenticated.key);
  const html = renderToStaticMarkup(unauthenticated);
  assert.match(html, /運営者アカウントでログイン/);
  for (const label of ["レビューキューを読み込む", "取得状況を読み込む", "通常ニュースを読み込む", "取得・記事の診断を読み込む", "年次報告書を開く"]) assert.match(button(html, label), /disabled/, label);
  assert.doesNotMatch(html, /保存原文の照合結果|Source SHA:|現在の生成対象 \d|速報レビューキュー/);
});

test("all news panels select the session-only route without sending bearer null or persisting credentials", () => {
  for (const filename of files) {
    const source = readFileSync(new URL(filename, directory), "utf8");
    assert.match(source, /=== null \? "editor-owner" : "editor"/, filename);
    assert.match(source, /=== null \? \{\} : \{ Authorization:/, filename);
    assert.match(source, /credentials: "same-origin"/, filename);
    assert.match(source, /tech-phase:membership-changed/, filename);
    assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie|RESEARCH_EDITOR_TOKEN/, filename);
  }
  const dashboard = readFileSync(new URL("review-dashboard.tsx", directory), "utf8");
  assert.match(dashboard, /kind === "annual" \? token : newsToken/);
  assert.match(dashboard, /token.length >= 24 \? request\("GET", undefined, "annual"/);
});
