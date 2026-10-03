import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const signalsSource = await readFile(new URL("../app/research/review/signals-panel.tsx", import.meta.url), "utf8");
const signalsCompiled = ts.transpileModule(signalsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const signalsLoaded = { exports: {} };
new Function("require", "module", "exports", signalsCompiled)(name => name.endsWith(".module.css") ? { default: {} } : name === "@/lib/research/x-target-preview" ? require("../lib/research/x-target-preview.ts") : require(name), signalsLoaded, signalsLoaded.exports);
const source = await readFile(new URL("../app/research/review/official-research-panel.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function("require", "module", "exports", compiled)(name => name.endsWith(".module.css") ? { default: {} } : name === "./signals-panel" ? signalsLoaded.exports : require(name), loaded, loaded.exports);
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

const { NewsPipelineOverview, OfficialResearchResults, TerminalReviewOverview } = loaded.exports;
const editorToken = "synthetic-private-pipeline-editor-token";
const timestamp = "2026-10-03T10:00:00Z";
const rawRecord = {
  sourceId: "x-fixture-review", url: "https://x.com/fixture/status/123", sha: "raw-review-source-sha",
  bodySha: "raw-review-body-sha", publishedAt: timestamp, firstSeenAt: timestamp, lastSeenAt: timestamp,
  acquisitionSelected: true, currentRevision: true, eventId: 123, representativeEventId: 456,
  disposition: "review-required", reason: "unbound-material-subject", representativeValidatedPublication: false,
};
const issuerRecord = {
  eventId: 789, sourceId: "issuer-fixture", url: "https://example.com/issuer-news", title: "Fixture issuer news",
  sourceSha: "issuer-source-sha", bodySha: "issuer-body-sha", preparationReason: "unsupported-facts",
  generationDisposition: "held-before-generation", generationEligibilityReason: "company-role-unresolved",
  companyRoleEvidence: null, job: null, nextPreparationAt: null, nextGenerationAt: null,
};
function pipelineFixture() {
  return {
    check: "editor-only-news-pipeline-metadata", configuredModel: "gpt-4.1-mini",
    issuerPreparation: {
      scope: "current-issuer-preparation", readOnly: true, total: 1, counts: { "unsupported-facts": 1 },
      records: [{ ...issuerRecord }], recordsOmitted: 0,
      notice: "Preparation statuses overlap generation/publication lanes; they are not additional missing-story counts.",
    },
    retainedIntake: {
      readOnly: true, scope: "retained-approved-account-revisions", windowDays: 7,
      counts: {
        retainedRevisionRows: 2, acquisitionSelectedRows: 1, rowsWithEvent: 1, eligibleRetainedRows: 0,
        representedRows: 0, validatedPublicationRows: 0, deduplicatedRows: 0, awaitingAdmissionRows: 0,
        acquisitionOnlyGapRows: 0, excludedRows: 1, reviewRequiredRows: 1, independentRouteRows: 0,
        assessedReviewRows: 0, assessmentPendingRows: 0, currentOrigins: 2,
      },
      reasons: { "unbound-material-subject": 1, "outside-news-window": 1 },
      records: [{ ...rawRecord }, {
        ...rawRecord, sourceId: "x-fixture-excluded", url: null, sha: "raw-excluded-source-sha", bodySha: null,
        eventId: null, representativeEventId: null, disposition: "excluded", reason: "outside-news-window",
        acquisitionSelected: false, currentRevision: false,
      }],
      recordLimit: 50, recordsTruncated: false,
      coverage: {
        retainedOnly: true, retentionTargetRows: 1000, retentionTargetIsSoft: true, sourcesAboveRetentionTarget: 0,
        completeUpstreamCoverage: false, browserDeliveryVerified: false,
      },
    },
    acquisitionCoverage: {
      "x-fixture-review": {
        retainedOnly: true, completeUpstreamCoverage: false, assessmentCoverage: "not-measured-by-acquisition",
        retentionTargetRows: 1000, retentionTargetIsSoft: true, retainedAcquisitionRows: 2, rowsAboveRetentionTarget: 0,
        trackingStartedAt: timestamp, historicalOmissionsBeforeTrackingUnknown: true,
        knownOmittedAcquisitionRows: 7, knownOmittedDocumentRows: 8, knownOmittedEventRows: 9,
        currentQueryTracked: true, paginationPending: true, awaitingFirstPage: false, initialWindowExpired: false,
        acquisitionState: "pagination-pending", generationStartedAt: timestamp, coverageStartedAt: timestamp,
        pagesSaved: 2, postObservationsSaved: 2, excludedAuthorRows: 0, truncatedPostObservations: 0,
      },
    },
  };
}
const emptyQueue = pipelineDiagnostics => ({
  items: [], generatedAt: timestamp, filteredTotal: 0,
  counts: { candidates: 4, validatedPublications: 4, pending: 0 }, pipelineDiagnostics,
});
const renderOverview = data => renderToStaticMarkup(NewsPipelineOverview({ data, token: editorToken }));
const renderResults = data => renderToStaticMarkup(OfficialResearchResults({ data, token: editorToken }));

test("zero pending articles still exposes retained review and excluded records independently of queue counts", () => {
  const queue = emptyQueue(pipelineFixture());
  const before = structuredClone(queue);
  const html = renderResults(queue);
  for (const text of [
    "現在の生成対象 4件", "有効な保存記事 4件", "未公開 0件", "0/0件を表示",
    "x-fixture-review", "x-fixture-excluded", "raw-review-source-sha", "raw-review-body-sha",
    "raw-excluded-source-sha", "unbound-material-subject", "outside-news-window", "投稿ID 123 · イベント 123", "対応する代表イベント 456",
    "要確認 1行", "対象外 1行", "イベント未作成のため",
    "issuer-fixture", "issuer-source-sha", "issuer-body-sha", "unsupported-facts", "company-role-unresolved",
  ]) assert.ok(html.includes(text), text);
  assert.match(html, /現在の生成対象に未公開記事はありません/);
  assert.match(html, /未公開0件は全投稿の取得・掲載完了を意味しません/);
  assert.match(html, /追加の未公開件数として合算しません/);
  assert.deepEqual(queue, before);
  assert.equal(queue.counts.pending, 0);
});

test("private overview shows configured model metadata without rendering the editor credential", () => {
  const html = renderOverview(pipelineFixture());
  assert.match(html, /gpt-4\.1-mini/);
  assert.match(html, /編集者用|非公開/);
  assert.match(html, /読取専用/);
  assert.doesNotMatch(html, /synthetic-private-pipeline-editor-token|Bearer |<input|<form/);
  assert.doesNotMatch(renderResults(emptyQueue(pipelineFixture())), /synthetic-private-pipeline-editor-token/);
  const absentModel = pipelineFixture();
  absentModel.configuredModel = null;
  assert.match(renderOverview(absentModel), /識別子を確認できません/);
  assert.doesNotMatch(renderOverview(absentModel), /gpt-4\.1-mini/);
});

test("absent pipeline metadata is unavailable even when the publication queue has no pending articles", () => {
  for (const missing of [undefined, null]) {
    const html = renderResults(emptyQueue(missing));
    assert.match(html, /未公開 0件/);
    assert.match(html, /取得・分類の概要は未取得/);
    assert.match(html, /未公開0件だけでは網羅性を確認できません/);
    assert.doesNotMatch(html, /全件取得済み|全件公開済み|すべて取得済み|すべて公開済み|網羅済み|gpt-4\.1-mini/);
  }
});

test("overview discloses retained-only coverage, unknown historical omissions and bounded record omissions", () => {
  const data = pipelineFixture();
  data.retainedIntake.recordsTruncated = true;
  data.retainedIntake.responseOmittedRecords = 3;
  data.issuerPreparation.recordsOmitted = 4;
  data.issuerPreparation.responseOmittedRecords = 5;
  const html = renderOverview(data);
  assert.match(html, /保存済みの版だけが対象/);
  assert.match(html, /全投稿の網羅性は保証せず/);
  assert.match(html, /ブラウザ[ー]?.*(?:未検証|未確認)/);
  assert.match(html, /計測開始前の欠落数は不明/);
  assert.equal((html.match(/一部省略されています/g) ?? []).length, 2);
  assert.match(html, /上の集計は表示分だけの件数ではありません/);
  assert.match(html, /pagination-pending/);
  assert.match(html, /計測済み省略: 投稿 7行 \/ 文書 8行 \/ イベント 9行/);
  assert.doesNotMatch(html, /全件取得済み|全件公開済み|網羅済み/);
});

test("source inspection controls are offered only for positive safe integer event IDs", () => {
  for (const eventId of [null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "123", true, 123, Number.MAX_SAFE_INTEGER]) {
    const data = pipelineFixture();
    data.retainedIntake.records = [{ ...rawRecord, eventId, representativeEventId: null }];
    data.issuerPreparation.records = [{ ...issuerRecord, eventId }];
    const html = renderOverview(data);
    const controls = html.match(/保存原文を確認（編集者用）/g) ?? [];
    assert.equal(controls.length, Number.isSafeInteger(eventId) && eventId > 0 ? 2 : 0, String(eventId));
    assert.doesNotMatch(html, /synthetic-private-pipeline-editor-token/);
  }
});

test("pipeline record links reject unsafe URLs and embedded credentials in both evidence lanes", () => {
  const urls = ["https://example.com/safe", "javascript:alert(1)", "data:text/html,test", "//example.com/post", "/post", "https://fixture:secret@example.com/post", "not a url", null];
  const data = pipelineFixture();
  data.retainedIntake.records = urls.map((url, index) => ({ ...rawRecord, url, eventId: index + 1, representativeEventId: null }));
  data.issuerPreparation.records = urls.map((url, index) => ({ ...issuerRecord, url, eventId: index + 1 }));
  const html = renderOverview(data);
  assert.equal((html.match(/<a /g) ?? []).length, 2);
  assert.equal((html.match(/href="https:\/\/example\.com\/safe"/g) ?? []).length, 2);
  assert.equal((html.match(/rel="noopener noreferrer"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /javascript:|data:text|fixture:secret/);
});

function inspectionIds(element) {
  if (Array.isArray(element)) return element.flatMap(inspectionIds);
  if (!element || typeof element !== "object") return [];
  if (element.type === signalsLoaded.exports.SignalSourceInspection) return [element.props.eventId];
  return inspectionIds(element.props?.children);
}

test("raw source inspection uses a safe representative only when the original event is absent or invalid", () => {
  for (const [eventId, representativeEventId, expected] of [[null, 456, [456]], [123, 456, [123]], [0, 456, [456]], [null, -1, []], [null, "456", []], [null, Number.MAX_SAFE_INTEGER + 1, []]]) {
    const data = pipelineFixture();
    data.retainedIntake.records = [{ ...rawRecord, eventId, representativeEventId }];
    data.issuerPreparation.records = [];
    assert.deepEqual(inspectionIds(NewsPipelineOverview({ data, token: editorToken })), expected);
  }
});

test("each record omission signal warns independently and oversized lists remain bounded", () => {
  for (const [lane, key] of [["retainedIntake", "recordsTruncated"], ["retainedIntake", "responseOmittedRecords"], ["issuerPreparation", "recordsOmitted"], ["issuerPreparation", "responseOmittedRecords"]]) {
    const data = pipelineFixture();
    data[lane][key] = key === "recordsTruncated" ? true : 1;
    assert.equal((renderOverview(data).match(/一部省略されています/g) ?? []).length, 1, `${lane}.${key}`);
  }
  const data = pipelineFixture();
  data.retainedIntake.counts.retainedRevisionRows = data.issuerPreparation.total = 51;
  data.retainedIntake.records = Array.from({ length: 51 }, (_, index) => ({ ...rawRecord, sourceId: `raw-${index}`, eventId: index + 1 }));
  data.issuerPreparation.records = Array.from({ length: 51 }, (_, index) => ({ ...issuerRecord, sourceId: `issuer-${index}`, eventId: index + 1 }));
  const html = renderOverview(data);
  assert.match(html, /50\/51行表示/);
  assert.match(html, /50\/51件表示/);
  assert.doesNotMatch(html, /raw-50|issuer-50/);
  assert.equal((html.match(/一部省略されています/g) ?? []).length, 2);
  assert.equal(data.retainedIntake.counts.retainedRevisionRows, 51);
});

const terminalRecord = {
  eventId: 321, sourceId: "terminal-fixture", url: "https://example.com/terminal-news",
  title: "Semantic review fixture", ticker: "MSFT", currentSha: "terminal-source-sha", bodySha: "terminal-body-sha",
  observedAt: timestamp, bodyReadyAt: timestamp, status: "terminal-review",
  review: { reason: "company-actor-mismatch", decidedAt: timestamp },
  publication: { present: false, currentRevision: false, validation: { status: "unavailable", issues: [] } },
  job: { state: "review", attempts: 1, nextRetryAt: null, currentRevision: true, failureKind: "unsupported-facts" },
  latestFailure: {
    failedAt: timestamp, reason: "unsupported-facts", validation: { status: "invalid", issues: [{
      field: "facts[0]", issue: "company-actor-mismatch", checks: [{
        failedJa: "失敗した日本語の文章", failedEn: "Failed English copy", sourceEvidence: "Exact saved source evidence",
      }],
    }] },
  },
};
const renderTerminal = data => renderToStaticMarkup(TerminalReviewOverview({ data, token: editorToken }));

test("zero pending articles still shows terminal semantic review with failed copy and independent totals", () => {
  for (const pipelineDiagnostics of [undefined, pipelineFixture()]) {
    const queue = { ...emptyQueue(pipelineDiagnostics), terminalReviews: { items: [terminalRecord], total: 1, omitted: 0 } };
    const before = structuredClone(queue);
    const html = renderResults(queue);
    for (const text of ["未公開 0件", "0/0件を表示", "要確認（自動再試行なし）", "要確認 1件（1/1件表示）", "省略 0件",
      "Semantic review fixture", "イベント 321", "terminal-source-sha", "terminal-body-sha", "要確認の理由: company-actor-mismatch",
      "unsupported-facts", "facts[0]", "失敗した日本語の文章", "Failed English copy", "Exact saved source evidence",
      "自動生成対象の未公開件数には含みません", "現在の生成対象に未公開記事はありません"]) assert.ok(html.includes(text), text);
    assert.deepEqual(queue, before);
    assert.equal(queue.counts.pending, 0);
  }
});

test("terminal review display stays read-only, reuses source inspection and never renders retry scheduling", () => {
  const data = { items: [terminalRecord], total: 1, omitted: 0 };
  const html = renderTerminal(data);
  assert.match(html, /編集者用・読取専用/);
  assert.match(html, /生成・再試行・公開を実行しません/);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.match(html, /保存原文を確認（編集者用）/);
  assert.deepEqual(inspectionIds(TerminalReviewOverview({ data, token: editorToken })), [321]);
  assert.doesNotMatch(html, /次の実行可能時刻|実行期限|再試行待ち|生成中|公開済み|掲載済み|<form|<input|Bearer |synthetic-private-pipeline-editor-token/);
  const noFailure = renderTerminal({ ...data, items: [{ ...terminalRecord, latestFailure: null }] });
  assert.match(noFailure, /同じ原文版の失敗記録はありません/);
  assert.doesNotMatch(noFailure, /失敗した日本語の文章|Failed English copy|Exact saved source evidence/);
});

test("terminal review lists bound browser display to 50 and disclose server and browser omissions", () => {
  const items = Array.from({ length: 51 }, (_, index) => ({ ...terminalRecord, eventId: index + 1, title: `terminal-record-${index}` }));
  const data = { items, total: 55, omitted: 4 };
  const before = structuredClone(data);
  const html = renderTerminal(data);
  assert.equal((html.match(/<article/g) ?? []).length, 50);
  assert.match(html, /50\/55件表示/);
  assert.match(html, /省略 5件/);
  assert.match(html, /一部省略されています/);
  assert.doesNotMatch(html, /terminal-record-50/);
  assert.deepEqual(data, before);
  const allOmitted = renderTerminal({ items: [], total: 3, omitted: 3 });
  assert.match(allOmitted, /0\/3件表示/);
  assert.match(allOmitted, /省略 3件/);
  assert.doesNotMatch(allOmitted, /保存済みの要確認記録はありません/);
});

test("terminal-empty is explicit while older API responses remain compatible without a false empty claim", () => {
  for (const missing of [undefined, null]) {
    assert.equal(renderTerminal(missing), "");
    const html = renderResults({ ...emptyQueue(), terminalReviews: missing });
    assert.match(html, /現在の生成対象に未公開記事はありません/);
    assert.doesNotMatch(html, /要確認（自動再試行なし）|保存済みの要確認記録はありません/);
  }
  const html = renderResults({ ...emptyQueue(), terminalReviews: { items: [], total: 0, omitted: 0 } });
  assert.match(html, /要確認 0件（0\/0件表示）/);
  assert.match(html, /保存済みの要確認記録はありません/);
  assert.doesNotMatch(html, /保存原文を確認（編集者用）|Semantic review fixture|全件公開済み/);
});

test("terminal review source inspection validates event IDs and rejects unsafe source links", () => {
  const html = renderTerminal({ items: [{ ...terminalRecord, eventId: -1, url: "https://fixture:secret@example.com/post" }], total: 1, omitted: 0 });
  assert.doesNotMatch(html, /<a |fixture:secret|保存原文を確認（編集者用）/);
});
