import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/research/review/retained-source-proof.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(react = require("react")) {
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => name === "react" ? react : name.endsWith(".module.css") ? { default: {} } : require(name), loaded, loaded.exports);
  return loaded.exports;
}
const api = load();
const sourceSha = "a".repeat(64), sourceId = "x-wallstengine", url = "https://x.com/wallstengine/status/2106737247274065925";
const selection = { token: null, sourceId, url, sourceSha };
const fixture = () => ({ sourceId, url, expectedSourceSha: sourceSha, sourceSha, currentOriginSha: sourceSha,
  sourceKind: "retained-x-acquisition", status: "current", currentRevision: true, textIncluded: true,
  researchBodyIncluded: false, text: "  Exact stored\r\n本文 <script>bad()</script> tail.  ", title: "Stored title",
  bodySha256: "b".repeat(64), bodyChars: 53, bodyBytes: 57, returnedBodyChars: 53, omittedBodyChars: 0,
  sourceTruncated: false, selectedForProcessing: false, generatedAt: "2026-10-04T14:00:00Z",
  publishedAt: { value: "2026-10-04T13:24:35Z", omitted: false }, firstSeenAt: { value: "2026-10-04T13:25:09Z", omitted: false }, lastSeenAt: { value: "2026-10-04T13:58:00Z", omitted: false } });
const render = data => renderToStaticMarkup(api.RetainedSourceProofResult({ data }));
test("retained exact text is escaped and acquisition, source and research clocks stay distinct", () => {
  const data = fixture(); const before = structuredClone(data); const html = render(data);
  for (const phrase of ["  Exact stored", "本文 &lt;script&gt;bad()&lt;/script&gt; tail.  ", "イベント未作成でも", "研究本文・生成時本文・保存記事とは別", "13:24:35Z", "13:25:09Z", "13:58:00Z", "初回取得と再観測は別", "処理選択フラグ: なし", "保存された表題＋改行＋本文", "Stored body SHA-256", "開示省略 0文字"]) assert.ok(html.includes(phrase), phrase);
  assert.doesNotMatch(html, /<script>|Bearer|providerArguments|公開する|再試行する/); assert.deepEqual(data, before);
});
test("old hashes, stale rows, body/query limits and mismatched envelopes never render text", () => {
  for (const override of [{ status: "stale-selection" }, { status: "query-limit" }, { status: "body-limit", omittedBodyChars: 160001 }, { currentRevision: false }, { sourceSha: "c".repeat(64) }, { currentOriginSha: "c".repeat(64) }, { researchBodyIncluded: true }, { textIncluded: false }, { sourceKind: "research-body" }]) {
    const html = render({ ...fixture(), ...override }); assert.match(html, /保存本文は表示しません/); assert.doesNotMatch(html, /Exact stored/);
  }
  assert.match(render({ ...fixture(), sourceTruncated: true }), /取得時の切り詰め あり/);
});
test("inspection is opt-in and keyed to every selector and credential", () => {
  const first = api.RetainedSourceProofInspection(selection);
  for (const change of [{ token: "different-token" }, { sourceSha: "c".repeat(64) }, { sourceId: "x-tipranks" }, { url: url.replace("2106737247274065925", "123") }]) assert.notEqual(first.key, api.RetainedSourceProofInspection({ ...selection, ...change }).key);
  for (const invalid of [{ token: "short" }, { sourceSha: "bad" }, { sourceId: "../source" }, { url: url + "?query" }, { url: url.replace("x.com", "x.com.evil") }]) assert.match(renderToStaticMarkup(api.RetainedSourceProofInspection({ ...selection, ...invalid })), /disabled=""/);
  assert.doesNotMatch(renderToStaticMarkup(first), /Exact stored|Stored body SHA-256/);
});
function harness(input = selection) {
  const states = []; let index = 0; let cleanup;
  const hooks = { useState(initial) { const i = index++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; }, useRef(initial) { const i = index++; if (!(i in states)) states[i] = { current: initial }; return states[i]; }, useEffect(effect) { if (!cleanup) cleanup = effect(); } };
  const custom = load(hooks); const entry = custom.RetainedSourceProofInspection(input);
  const render = () => { index = 0; return entry.type(entry.props); };
  function find(node, predicate) { if (Array.isArray(node)) return node.map(value => find(value, predicate)).find(Boolean); if (!node || typeof node !== "object") return null; return predicate(node) ? node : find(node.props?.children, predicate); }
  return { button: () => find(render(), node => node.type === "button"), close: () => find(render(), node => node.type === "button" && node.props.children === "閉じる・取得を中止"), result: () => find(render(), node => node.type === custom.RetainedSourceProofResult), error: () => find(render(), node => node.props?.role === "alert"), cleanup: () => cleanup?.() };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test("repeated, closed and unmounted callbacks are aborted, including expired-owner events", async () => {
  const savedFetch = globalThis.fetch; const savedWindow = globalThis.window; const pending = []; const events = [];
  globalThis.fetch = (value, init) => new Promise(resolve => pending.push({ url: new URL(value, "https://example.test"), init, resolve }));
  globalThis.window = { dispatchEvent: event => events.push(event.type) };
  const h = harness();
  try {
    h.button().props.onClick(); const first = pending[0];
    assert.equal(first.url.pathname, "/api/research/editor-owner");
    assert.deepEqual(Object.fromEntries(first.url.searchParams), { kind: "official-research", retainedSourceId: sourceId, retainedUrl: url, expectedSourceSha: sourceSha });
    assert.equal(first.init.method ?? "GET", "GET"); assert.deepEqual(first.init.headers, {});
    h.button().props.onClick(); assert.equal(first.init.signal.aborted, true);
    pending[1].resolve(Response.json({ ok: true, detail: fixture() })); await settle(); assert.ok(h.result());
    first.resolve(Response.json({ ok: false }, { status: 403 })); await settle(); assert.ok(h.result()); assert.deepEqual(events, []);
    h.button().props.onClick(); assert.equal(h.result(), undefined); h.close().props.onClick(); assert.equal(pending[2].init.signal.aborted, true);
    pending[2].resolve(Response.json({ ok: true, detail: fixture() })); await settle(); assert.equal(h.result(), undefined);
    h.button().props.onClick(); h.cleanup(); assert.equal(pending[3].init.signal.aborted, true);
    pending[3].resolve(Response.json({ ok: true, detail: fixture() })); await settle(); assert.equal(h.result(), undefined);
  } finally { h.cleanup(); globalThis.fetch = savedFetch; globalThis.window = savedWindow; }
});
test("different-author URL, source or old SHA responses cannot be attached to a current selection", async () => {
  const savedFetch = globalThis.fetch;
  try {
    for (const override of [{ sourceId: "x-tipranks" }, { url: url.replace("wallstengine", "tipranks") }, { sourceSha: "f".repeat(64) }, { expectedSourceSha: "f".repeat(64) }, { currentOriginSha: "f".repeat(64) }]) {
      globalThis.fetch = async () => Response.json({ ok: true, detail: { ...fixture(), ...override } });
      const h = harness(); h.button().props.onClick(); await settle(); assert.equal(h.result(), undefined); assert.ok(h.error()); h.cleanup();
    }
    const token = "synthetic-editor-token-long-enough"; let called;
    globalThis.fetch = async (url, init) => { called = { url, init }; return Response.json({ ok: true, detail: fixture() }); };
    const h = harness({ ...selection, token }); h.button().props.onClick(); await settle();
    assert.match(called.url, /\/editor\?/); assert.deepEqual(called.init.headers, { Authorization: `Bearer ${token}` }); h.cleanup();
  } finally { globalThis.fetch = savedFetch; }
});
