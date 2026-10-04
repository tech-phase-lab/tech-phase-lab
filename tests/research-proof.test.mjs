import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/research/review/research-proof.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(react = require("react")) {
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => name === "react" ? react : name.endsWith(".module.css") ? { default: {} } : require(name), loaded, loaded.exports);
  return loaded.exports;
}
const api = load();
const text = value => ({ text: value, chars: value?.length ?? null, truncated: false });
const sourceSha = "a".repeat(64), bodySha = "b".repeat(64);
const evidence = { ...text("Exact selected evidence."), literalCurrentResearchBody: true };
const copy = value => ({ status: "included", payloadSha256: "c".repeat(64), complete: true, omittedFacts: 0,
  fields: [{ field: "facts[0]", ja: text(value), en: text("Original English copy"), savedEvidenceQuote: evidence, currentEvidenceId: null, resolvedCurrentEvidence: null }] });
function fixture() {
  return { eventId: 1233, status: "current", currentRevision: true, sourceSha, bodySha, sourceId: "primary-ir-GOOGL", url: "https://blog.google/example", title: text("Stored source title"), generatedAt: "2026-10-04T07:50:00Z", sourceClock: { value: "2026-10-01", precision: "date" }, storedObservedAt: text("2026-10-02T00:00:00Z"),
    acquisition: { kind: "primary-source-revision", present: true, chars: 139, revisionSha: "d".repeat(64), bodyTextSha256: "e".repeat(64), matchesResearchBody: false },
    researchBody: { storageKind: "official-story-body", revisionSha: bodySha, bodyTextSha256: bodySha, text: "Full current research body. Exact selected evidence.", chars: 50, returnedChars: 50, truncated: false, storedBodyAt: text("2026-10-04T07:30:00Z") },
    publication: { present: true, currentRevision: true, sourceSha, bodySha, storedClocks: { startedAt: text("raw-start"), publicAt: text("raw-invalid-clock"), generationMs: 12 }, copy: copy("  保存公開記事の原文  "), validation: { status: "invalid" }, selectedEvidence: { status: "included", items: [evidence], omitted: 0 }, derivation: { kind: "source-structured-buyback", version: 1, storedDerivedAt: text("2026-10-04T07:00:00Z"), currentAuditValidated: true } },
    latestFailure: { status: "current-attempt-body-proven", sourceSha, bodySha, reason: "unsupported-number", storedFailedAt: text("2026-10-04T07:45:00Z"), copy: copy("  直近失敗の原文  "), validation: { status: "invalid" } }, job: { state: "retry", attempts: 5, currentSourceRevision: true } };
}
const render = data => renderToStaticMarkup(api.ResearchProofResult({ data }));
test("selected proof keeps acquisition, current body, saved article and proven failed copy separate", () => {
  const data = fixture(); const before = structuredClone(data); const html = render(data);
  for (const phrase of ["取得元文書 139文字", "研究本文と同一 いいえ", "Full current research body.", "保存公開記事の文章", "  保存公開記事の原文  ", "直近の失敗した文章", "  直近失敗の原文  ", "Exact selected evidence.", "raw-invalid-clock", "正当性・初回公開を保証しません", "初回取得とは限りません", "source-structured-buyback", "現在の監査照合 通過"]) assert.ok(html.includes(phrase), phrase);
  assert.deepEqual(data, before); assert.doesNotMatch(html, /<form|公開する|再試行する|Bearer |providerArguments/);
});
test("stale envelopes, publication revisions and failed-proof bindings never render unbound text", () => {
  for (const status of ["stale-selection", "body-limit", "research-body-integrity-mismatch"]) {
    const html = render({ ...fixture(), status }); assert.match(html, /本文・保存文章は表示しません/); assert.doesNotMatch(html, /Full current research body|保存公開記事の原文|直近失敗の原文/);
  }
  const stale = fixture(); stale.publication.bodySha = "f".repeat(64); stale.latestFailure.sourceSha = "f".repeat(64);
  const html = render(stale); assert.match(html, /Full current research body/); assert.doesNotMatch(html, /保存公開記事の原文|直近失敗の原文/);
  const unavailable = fixture(); unavailable.latestFailure.status = "unavailable"; assert.doesNotMatch(render(unavailable), /直近失敗の原文/);
});
test("copy truncation, source date precision and absent proof are explicit", () => {
  const data = fixture(); data.publication.copy.complete = false; data.publication.copy.fields[0].ja.truncated = true; data.publication.copy.fields[0].ja.chars = 2500; data.latestFailure = { status: "unavailable", copy: null };
  const html = render(data); assert.match(html, /表示上限により省略/); assert.match(html, /2500文字/); assert.match(html, /2026-10-01（date）/); assert.match(html, /生成時本文の記録が同じ版に一致/); assert.doesNotMatch(html, /2026\/10\/1 9:00/);
});
test("inspection is explicit, credential-and-revision keyed, and disables invalid selectors", () => {
  const base = { token: null, eventId: 1233, sourceSha, bodySha };
  const first = api.ResearchProofInspection(base); const next = api.ResearchProofInspection({ ...base, bodySha: "f".repeat(64) });
  assert.notEqual(first.key, next.key); assert.doesNotMatch(renderToStaticMarkup(first), /Full current research body|保存公開記事の原文/);
  for (const invalid of [{ eventId: 0 }, { eventId: 1e12 }, { sourceSha: "wrong" }, { token: "short" }]) assert.match(renderToStaticMarkup(api.ResearchProofInspection({ ...base, ...invalid })), /disabled=""/);
});
function harness() {
  const states = []; let index = 0; let cleanup;
  const hooks = { useState(initial) { const i = index++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; }, useRef(initial) { const i = index++; if (!(i in states)) states[i] = { current: initial }; return states[i]; }, useEffect(effect) { if (!cleanup) cleanup = effect(); } };
  const custom = load(hooks); const entry = custom.ResearchProofInspection({ token: null, eventId: 1233, sourceSha, bodySha });
  const render = () => { index = 0; return entry.type(entry.props); };
  function find(node, predicate) { if (Array.isArray(node)) return node.map(value => find(value, predicate)).find(Boolean); if (!node || typeof node !== "object") return null; return predicate(node) ? node : find(node.props?.children, predicate); }
  return { button: () => find(render(), node => node.type === "button"), result: () => find(render(), node => node.type === custom.ResearchProofResult), cleanup: () => cleanup?.() };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test("repeat and interrupted reads remain GET-only and stale responses cannot expose another revision", async () => {
  const previous = globalThis.fetch; const pending = [];
  globalThis.fetch = (url, init) => new Promise(resolve => pending.push({ url: new URL(url, "https://example.test"), init, resolve }));
  const testHarness = harness();
  try {
    const button = testHarness.button(); button.props.onClick();
    assert.equal(pending[0].url.pathname, "/api/research/editor-owner");
    assert.equal(pending[0].url.searchParams.get("expectedSourceSha"), sourceSha);
    assert.equal(pending[0].url.searchParams.get("expectedBodySha"), bodySha);
    assert.equal(pending[0].init.method ?? "GET", "GET"); assert.deepEqual(pending[0].init.headers, {});
    button.props.onClick(); assert.equal(pending[0].init.signal.aborted, true);
    pending[1].resolve(Response.json({ ok: true, detail: fixture() })); await settle(); assert.ok(testHarness.result());
    pending[0].resolve(Response.json({ ok: true, detail: { ...fixture(), bodySha: "f".repeat(64) } })); await settle(); assert.equal(testHarness.result().props.data.bodySha, bodySha);
    testHarness.button().props.onClick(); assert.equal(testHarness.result(), undefined); testHarness.cleanup(); assert.equal(pending[2].init.signal.aborted, true);
    pending[2].resolve(Response.json({ ok: true, detail: fixture() })); await settle(); assert.equal(testHarness.result(), undefined);
  } finally { testHarness.cleanup(); globalThis.fetch = previous; }
});
