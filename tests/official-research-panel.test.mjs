import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../app/research/review/official-research-panel.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)(name => name.endsWith(".module.css") ? { default: {} } : require(name), loaded, loaded.exports);
const Panel = loaded.exports.default;

test("diagnostics encapsulates all state in a credential-keyed session without exposing the token", () => {
  const first = Panel({ token: "synthetic-first-editor-token" });
  const next = Panel({ token: "synthetic-next-editor-token" });
  const cleared = Panel({ token: "" });
  assert.equal(first.type, next.type);
  assert.notEqual(first.key, next.key);
  assert.notEqual(next.key, cleared.key);
  for (const element of [first, next, cleared]) {
    const html = renderToStaticMarkup(element);
    assert.doesNotMatch(html, /synthetic-(?:first|next)-editor-token/);
    assert.doesNotMatch(html, /読み込み中…|前回取得時の記録|Source SHA:/);
  }
  assert.match(renderToStaticMarkup(cleared), /disabled=""/);
});
