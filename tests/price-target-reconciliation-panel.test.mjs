import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../app/research/review/signals-panel.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(hooks) {
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name.endsWith(".module.css")) return { default: {} };
    if (name === "@/lib/research/x-target-preview") return require("../lib/research/x-target-preview.ts");
    if (name === "react" && hooks) return { ...require(name), ...hooks };
    return require(name);
  }, loaded, loaded.exports);
  return loaded.exports;
}
const { default: Panel, PriceTargetReconciliation } = load();
const record = {
  sourceId: "x-test-source", url: "https://x.com/example/status/123", eventId: 123, sha: "fixture-sha",
  publishedAt: "2026-10-02T12:00:00Z", observedAt: "2026-10-02T12:00:01Z",
  disposition: "published", reason: "published", currentRevision: true,
};
const report = {
  windowDays: 7, windowBasis: "publishedAt", generatedAt: "2026-10-03T00:00:00Z",
  counts: { candidateRevisionRows: 41, uniqueSourcePosts: 35, publishedPosts: 21,
    unpublishedPosts: 9, rejectedPosts: 5, supersededRevisionRows: 6,
    eligibleActions: 29, returnedActions: 20, actionsOutsideFeedLimit: 9 },
  reasons: { published: 21, "feed-limit": 9, "unsupported-target": 5 }, records: [record],
  recordLimit: 50, recordsTruncated: false,
  coverage: { retainedOnly: true, rowsPerSourceLimit: 1000, browserDeliveryVerified: false, feedLimit: 20 },
};
const renderReport = overrides => renderToStaticMarkup(PriceTargetReconciliation({ report: { ...report, ...overrides }, token: "synthetic-first-editor-token" }));

test("reconciliation distinguishes revisions, source posts, actions and feed limits", () => {
  const html = renderReport();
  for (const text of ["候補の版 41行", "重複を除く投稿 35件", "旧版 6行", "フィード掲載判定 21投稿", "未公開 9投稿", "解析で除外 5投稿",
    "解析を通過した変更 29件", "フィード返却 20件", "フィード上限外 9件", "feed-limit", "unsupported-target"]) assert.ok(html.includes(text), text);
  assert.match(html, /フィードの上限20件による省略は、解析での除外とは別/);
  assert.match(html, /投稿数・版の行数と、重複をまとめた変更件数は数え方が異なります/);
});

test("reconciliation discloses all-source scope, retained coverage and unverified browser delivery", () => {
  const html = renderReport();
  assert.match(html, /投稿時刻（publishedAt）基準の直近7日・全発信元/);
  assert.match(html, /銘柄・種別フィルターとは独立/);
  assert.match(html, /読取専用/);
  assert.match(html, /保存済みデータのみ/);
  assert.match(html, /発信元ごとに最大1,000行の保持上限/);
  assert.match(html, /全投稿の網羅性は保証しません/);
  assert.match(html, /バックエンドの判定で、ブラウザーへの配信・表示は未検証/);
  assert.doesNotMatch(html, /<form|<input/);
  assert.match(html, /保存原文を確認（編集者用）/);
});

test("record links reject unsafe schemes, relative URLs and embedded credentials", () => {
  const urls = [record.url, "http://example.com/post", "javascript:alert(1)", "data:text/html,test", "//example.com/post", "/post", "https://user:secret@example.com/post", "not a url", null];
  const html = renderReport({ records: urls.map((url, index) => ({ ...record, eventId: index, url })) });
  assert.equal((html.match(/<a /g) ?? []).length, 2);
  assert.equal((html.match(/rel="noopener noreferrer"/g) ?? []).length, 2);
  assert.equal((html.match(/安全に開ける投稿元URLなし/g) ?? []).length, 7);
  assert.doesNotMatch(html, /javascript:|data:text|secret@example/);
});

test("record display is capped independently of backend truncation and exposes no raw text", () => {
  const records = Array.from({ length: 51 }, (_, index) => ({ ...record, eventId: index,
    sourceId: index === 50 ? "hidden-last-record" : `source-${index}`, text: "PRIVATE-RAW-TEXT", title: "PRIVATE-TITLE", token: "PRIVATE-TOKEN" }));
  const html = renderReport({ records, recordsTruncated: false });
  assert.match(html, /50件表示・最大50件/);
  assert.match(html, /一部を省略/);
  assert.match(html, /上の集計は表示した記録だけの件数ではありません/);
  assert.doesNotMatch(html, /hidden-last-record|PRIVATE-/);
  assert.match(renderReport({ records: [record], recordsTruncated: true }), /一部を省略/);
  const oldRecord = renderReport({ records: [{ ...record, disposition: "rejected", currentRevision: false, eventId: null, sha: null, publishedAt: null, observedAt: null }] });
  assert.match(oldRecord, /解析で除外/);
  assert.match(oldRecord, /理由 published · 旧版/);
  assert.match(oldRecord, /イベント 未記録 · SHA 未記録/);
  assert.match(renderReport({ records: [], reasons: {} }), /対象の記録はありません/);
});

test("signal diagnostics start a fresh credential-keyed session without exposing credentials", () => {
  const first = Panel({ token: "synthetic-first-editor-token" });
  const next = Panel({ token: "synthetic-next-editor-token" });
  const cleared = Panel({ token: "" });
  assert.equal(first.type, next.type);
  assert.notEqual(first.key, next.key);
  assert.notEqual(next.key, cleared.key);
  for (const element of [first, next, cleared]) {
    const html = renderToStaticMarkup(element);
    assert.doesNotMatch(html, /synthetic-(?:first|next)-editor-token|目標株価の突合|読み込み中…|前回取得時の記録/);
  }
  assert.match(renderToStaticMarkup(cleared), /disabled=""/);
});

test("data and errors are query-scoped within the credential session, including optional payloads", () => {
  const query = "kind=signals&view=targets&limit=30";
  const payload = { ok: true, items: [], routes: [], tickers: [], counts: {}, enabled: true, workerAlive: true,
    generatedAt: report.generatedAt, priceTargetReconciliation: report };
  function renderSession(key, data = payload) {
    const values = [true, "targets", "", 0, { key, data, displayedAt: report.generatedAt }, { key, message: "fixture-error" }];
    const LoadedPanel = load({ useState: initial => [values.length ? values.shift() : initial, () => {}], useEffect: () => {} }).default;
    return renderToStaticMarkup(LoadedPanel({ token: "synthetic-first-editor-token" }));
  }
  const matching = renderSession(query);
  assert.match(matching, /目標株価の突合/);
  assert.match(matching, /fixture-error/);
  assert.match(matching, /前回取得時の記録/);
  const changedQuery = renderSession(`${query}&ticker=OLD`);
  assert.doesNotMatch(changedQuery, /目標株価の突合|fixture-error|前回取得時の記録/);
  assert.match(changedQuery, /読み込み中…/);
  const absent = renderSession(query, { ...payload, priceTargetReconciliation: undefined });
  assert.doesNotMatch(absent, /目標株価の突合/);
});

test("source inspection is explicit, credential/event scoped and never exposes tokens", () => {
  const { SignalSourceInspection } = load();
  const first = SignalSourceInspection({ token: "synthetic-first-editor-token", eventId: 123 });
  const nextToken = SignalSourceInspection({ token: "synthetic-next-editor-token", eventId: 123 });
  const nextEvent = SignalSourceInspection({ token: "synthetic-first-editor-token", eventId: 456 });
  assert.notEqual(first.key, nextToken.key);
  assert.notEqual(first.key, nextEvent.key);
  const html = renderToStaticMarkup(first);
  assert.match(html, /保存原文を確認（編集者用）/);
  assert.doesNotMatch(html, /synthetic-first-editor-token|保存原文の照合結果|<pre/);
  assert.match(renderToStaticMarkup(SignalSourceInspection({ token: "", eventId: 123 })), /disabled=""/);
});

test("source inspection displays only bounded current plain text with identity and clocks", () => {
  const detail = { eventId: 123, sourceId: "fixture", sourceName: "Fixture source", sourceKind: "issuer-primary",
    url: record.url, title: "Fixture title", tickers: [], eventSha256: "event-sha", documentSha256: "document-sha", bodySha256: "body-sha",
    publishedAt: record.publishedAt, publishedOn: null, observedAt: record.observedAt, currentRevision: true, status: "current",
    bodyChars: 17, bodyAt: record.observedAt, firstSeenAt: record.observedAt, lastSeenAt: record.observedAt, sourceTruncated: false,
    text: "<script>PRIVATE-SOURCE</script>" };
  function renderDetail(overrides) {
    const values = [{ ...detail, ...overrides }, false, ""];
    const { SignalSourceInspection } = load({ useState: initial => [values.length ? values.shift() : initial, () => {}], useEffect: () => {} });
    return renderToStaticMarkup(SignalSourceInspection({ token: "synthetic-first-editor-token", eventId: 123 }));
  }
  const current = renderDetail({});
  assert.match(current, /&lt;script&gt;PRIVATE-SOURCE&lt;\/script&gt;/);
  assert.doesNotMatch(current, /<script>/);
  for (const text of ["イベント 123", "event-sha", "document-sha", "body-sha", "初回取得", "最終取得", "本文保存", "非公開・読取専用", "発信元ページ全体を完全に取得したことは保証しません"]) assert.ok(current.includes(text), text);
  for (const status of ["stale", "missing-document", "body-limit", "integrity-mismatch"]) {
    const html = renderDetail({ status });
    assert.doesNotMatch(html, /PRIVATE-SOURCE/);
    assert.match(html, /本文は表示しません/);
  }
  assert.doesNotMatch(renderDetail({ currentRevision: false }), /PRIVATE-SOURCE/);
  const bounded = renderDetail({ text: `${"x".repeat(160_000)}OUTSIDE-LIMIT` });
  assert.doesNotMatch(bounded, /OUTSIDE-LIMIT/);
  assert.match(bounded, /表示上限160,000文字/);
});

test("source inspection fetches only on click, clears a failed reload and ignores aborted responses", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  function harness() {
    const state = [{ eventId: 123, status: "stale", currentRevision: false, text: "OLD-BODY" }, false, ""];
    let slot = 0;
    let cleanup;
    const { SignalSourceInspection } = load({
      useState: () => { const index = slot++; return [state[index], value => { state[index] = value; }]; },
      useRef: () => ({ current: null }), useEffect: effect => { cleanup = effect(); },
    });
    const session = SignalSourceInspection({ token: "synthetic-first-editor-token", eventId: 123 });
    const tree = session.type(session.props);
    return { state, cleanup, click: tree.props.children[0].props.onClick };
  }
  try {
    globalThis.fetch = async (url, options) => {
      requests++;
      assert.equal(url, "/api/research/editor?kind=signals&eventId=123");
      assert.equal(options.headers.Authorization, "Bearer synthetic-first-editor-token");
      assert.equal(options.cache, "no-store");
      return Response.json({ ok: false }, { status: 503 });
    };
    const failed = harness();
    assert.equal(requests, 0);
    failed.click();
    assert.equal(failed.state[0], null);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests, 1);
    assert.equal(failed.state[0], null);
    assert.match(failed.state[2], /取得できません/);

    let resolveResponse;
    let signal;
    globalThis.fetch = (url, options) => {
      signal = options.signal;
      return new Promise(resolve => { resolveResponse = resolve; });
    };
    const pending = harness();
    pending.click();
    pending.cleanup();
    assert.equal(signal.aborted, true);
    resolveResponse(Response.json({ ok: true, detail: { eventId: 123, text: "LATE-BODY" } }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(pending.state[0], null);
    assert.equal(pending.state[2], "");
  } finally { globalThis.fetch = originalFetch; }
});
