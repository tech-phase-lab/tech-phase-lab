import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCoverageCompanies, coverageCompanyIssues, fetchState, filterSources, intakeCounts, pdfEvidenceCounts, pdfEvidenceState, secEvidenceCounts, secEvidenceState, snapshotIssues, coverageCounts, providers, providerByTicker } from "../lib/research/intake.ts";
const snapshot = JSON.parse(readFileSync(new URL("../lib/research/intake-snapshot.json", import.meta.url)));
const liveTypes = readFileSync(new URL("../lib/research/use-live-intake.ts", import.meta.url), "utf8");
const intakeDashboard = readFileSync(new URL("../app/research/intake/intake-dashboard.tsx", import.meta.url), "utf8");
const source = snapshot.sources.find(s => s.sha256);

test("snapshot has valid source references and no private review details", () => {
  assert.deepEqual(snapshotIssues(snapshot), []);
  for (const h of snapshot.history) {
    assert.equal("reviewer" in h, false);
    assert.equal("reason" in h, false);
  }
});

test("operations preview exposes verified backup health without storage details", () => {
  assert.match(liveTypes, /backup\?:/);
  assert.match(intakeDashboard, /DB保護：正常/);
  assert.match(intakeDashboard, /backupCount/);
  assert.match(intakeDashboard, /バックアップ期限超過/);
  assert.match(intakeDashboard, /monitor-stale/);
  assert.doesNotMatch(intakeDashboard, /backup\.(sha256|filename|path|directory)/);
});

test("operations preview exposes bounded cache pressure without cached contents", () => {
  assert.match(liveTypes, /fetchCache\?:/);
  assert.match(liveTypes, /maxEntries/);
  assert.match(liveTypes, /maxBytes/);
  assert.match(intakeDashboard, /公式一覧キャッシュ/);
  assert.match(intakeDashboard, /cache\.entries/);
  assert.match(intakeDashboard, /cache\.bytes/);
  assert.doesNotMatch(intakeDashboard, /cache\.(url|content|body)/);
});

test("operations preview describes PDF evidence extraction without stale unsupported copy", () => {
  assert.match(intakeDashboard, /no-extractable-text/);
  assert.match(intakeDashboard, /PDF取得済み・根拠本文の補完待ち/);
  for (const code of ["pdf-encrypted", "pdf-page-limit", "pdf-no-text", "pdf-timeout", "pdf-extract-failed"]) {
    assert.match(intakeDashboard, new RegExp(code));
  }
  assert.doesNotMatch(intakeDashboard, /文字抽出は未対応/);
});

test("PDF evidence totals separate extracted, pending, and latest errors", () => {
  const pdfUrl = "https://nebius.com/newsroom/official.pdf?revision=1";
  const pdf = { ...source, url: pdfUrl, content_type: null, extracted_chars: null, error: null };
  assert.deepEqual(pdfEvidenceCounts([
    { ...pdf, extracted_chars: 120 },
    { ...pdf, url: pdfUrl.replace("revision=1", "revision=2") },
    { ...pdf, url: pdfUrl.replace("revision=1", "revision=3"), error: "invalid-pdf" },
    { ...pdf, url: "https://nebius.com/newsroom/article", content_type: "text/html" },
  ]), { total: 3, extracted: 1, pending: 1, error: 1 });
  assert.equal(pdfEvidenceState({ ...pdf, extracted_chars: 120 }), "extracted");
  assert.equal(pdfEvidenceState({ ...pdf, error: "pdf-no-text" }), "error");
  assert.equal(pdfEvidenceState({ ...pdf, url: "https://nebius.com/newsroom/article", content_type: "text/html" }), null);
  assert.match(intakeDashboard, /PDF根拠：抽出済み/);
  assert.match(intakeDashboard, /補完待ち/);
  assert.match(intakeDashboard, /PDF補完待ち/);
});

test("PDF evidence filters isolate pending, extracted, and failed source work", () => {
  const pdfUrl = "https://nebius.com/newsroom/official.pdf";
  const pending = { ...source, url: pdfUrl, content_type: "application/pdf", extracted_chars: 0, error: null };
  const extracted = { ...pending, url: `${pdfUrl}?revision=2`, extracted_chars: 120 };
  const failed = { ...pending, url: `${pdfUrl}?revision=3`, error: "pdf-no-text" };
  const html = { ...source, url: "https://nebius.com/newsroom/article", content_type: "text/html" };
  const sources = [pending, extracted, failed, html];
  assert.deepEqual(filterSources(sources, "", "all", "all", "all", {}, "all", "pending"), [pending]);
  assert.deepEqual(filterSources(sources, "", "all", "all", "all", {}, "all", "extracted"), [extracted]);
  assert.deepEqual(filterSources(sources, "", "all", "all", "all", {}, "all", "error"), [failed]);
});

test("SEC evidence totals and filters distinguish exhibits from filing-body fallback", () => {
  const secUrl = "https://www.sec.gov/Archives/edgar/data/1835632/000119312526123456/form8-k.htm";
  const direct = { ...source, url: secUrl, evidence_url: secUrl, evidence_kind: "direct", error: null };
  const exhibit = { ...direct, url: secUrl.replace("123456", "123457"), evidence_url: secUrl.replace("form8-k.htm", "ex991.htm"), evidence_kind: "sec-exhibit-99.1" };
  const pending = { ...direct, url: secUrl.replace("123456", "123458"), sha256: null, checked_at: null };
  const failed = { ...pending, url: secUrl.replace("123456", "123459"), error: "sec-exhibit-unavailable" };
  const company = { ...source, url: "https://investors.example.com/news", evidence_kind: "direct" };
  const sources = [direct, exhibit, pending, failed, company];
  assert.deepEqual(secEvidenceCounts(sources), { total: 4, exhibit: 1, direct: 1, pending: 1, error: 1 });
  assert.equal(secEvidenceState(company), null);
  assert.deepEqual(filterSources(sources, "", "all", "all", "all", {}, "all", "all", "exhibit"), [exhibit]);
  assert.deepEqual(filterSources(sources, "", "all", "all", "all", {}, "all", "all", "direct"), [direct]);
  assert.deepEqual(filterSources(sources, "", "all", "all", "all", {}, "all", "all", "pending"), [pending]);
  assert.deepEqual(filterSources(sources, "", "all", "all", "all", {}, "all", "all", "error"), [failed]);
  assert.match(intakeDashboard, /SEC根拠：EX-99\.1取得/);
  assert.match(intakeDashboard, /SEC根拠エラー/);
  assert.match(intakeDashboard, /SEC根拠要確認/);
});

test("operations preview shows durable incident state while external delivery stays off", () => {
  assert.match(liveTypes, /incidents\?:/);
  assert.match(liveTypes, /heldNotifications/);
  assert.match(liveTypes, /pendingNotifications/);
  assert.match(liveTypes, /deadNotifications/);
  assert.match(intakeDashboard, /障害台帳：未復旧/);
  assert.match(intakeDashboard, /外部送信OFF/);
  assert.match(intakeDashboard, /通知送信ON/);
  assert.match(intakeDashboard, /再送確認が必要/);
  assert.match(intakeDashboard, /内部監視正常/);
  assert.match(intakeDashboard, /障害台帳の内部監視を再試行しています/);
});

test("latest failure wins over a previously successful fetch or editorial approval", () => {
  const errored = { ...source, error: "http-403", status: "approved" };
  assert.equal(fetchState(errored), "error");
  assert.equal(fetchState({ ...source, status: "pending" }), "fetched");
  assert.equal(fetchState({ ...source, sha256: null, checked_at: null }), "unfetched");
  assert.deepEqual(intakeCounts([errored]), { total: 1, error: 1, fetched: 0, unfetched: 0, pending: 0 });
});

test("combined filters search displayed titles without changing source records", () => {
  const titles = { [source.url]: "Quarterly results" };
  assert.equal(filterSources([source], " RESULTS ", source.ticker, "fetched", "pending", titles).length, 1);
  assert.equal(filterSources([source], "results", "all", "error", "all", titles).length, 0);
  assert.equal(filterSources([source], "", "all", "all", "held").length, 0);
});

test("unsafe links, duplicate records and broken history references fail validation", () => {
  assert.ok(snapshotIssues({ ...snapshot, sources: [...snapshot.sources, source] }).includes("duplicate-source"));
  assert.ok(snapshotIssues({ ...snapshot, sources: [{ ...source, url: "javascript:alert(1)" }] }).includes("unsafe-url"));
  assert.ok(snapshotIssues({ ...snapshot, sources: [{ ...source, evidence_url: "https://evil.test/ex991.htm" }] }).includes("unsafe-evidence-url"));
  assert.ok(snapshotIssues({ ...snapshot, sources: [{ ...source, evidence_url: `https://${providers.find(p => p.ticker === source.ticker).allowedHosts[0]}/not-an-article` }] }).includes("unsafe-evidence-path"));
  assert.ok(snapshotIssues({ ...snapshot, sources: [{ ...source, evidence_kind: "unverified" }] }).includes("invalid-evidence-kind"));
  assert.ok(snapshotIssues({ ...snapshot, history: [{ url: "missing", at: "2026-09-19" }] }).includes("invalid-history"));
  assert.ok(snapshotIssues({ ...snapshot, events: [{ id: 1, url: "missing", ticker: "NVDA", detected_at: snapshot.generatedAt, title: null, published_on: null }] }).includes("invalid-event"));
  assert.ok(snapshotIssues({ ...snapshot, events: [{ id: 1, url: source.url, ticker: source.ticker, detected_at: snapshot.generatedAt, title: null, published_on: null, detection_to_body_ms: -1 }] }).includes("invalid-event-latency"));
  assert.ok(snapshotIssues({ ...snapshot, discoveryRuns: [{ ...snapshot.discoveryRuns[0], sources_checked: 3, sources_configured: 2 }] }).includes("invalid-discovery-evidence"));
});

test("operations preview explains which official fallback recovered discovery", () => {
  assert.match(intakeDashboard, /取得経路の証跡/);
  assert.match(intakeDashboard, /sources_checked/);
  assert.match(intakeDashboard, /SEC Submissions JSON/);
  assert.match(intakeDashboard, /経路目で取得/);
  assert.match(intakeDashboard, /旧記録 · 経路詳細なし/);
});

test("reviewed briefs require current source identity, safe copy, status, and timestamps", () => {
  const brief = {
    url: source.url, ticker: source.ticker, title: "Official release", published_on: null,
    detected_at: null, source_sha256: source.sha256, source_checked_at: source.checked_at,
    summary_ja: "公式発表で確認できた事実を、根拠に沿って簡潔に説明します。",
    impact_label: "mixed", impact_ja: "好材料と未確認事項を分け、追加確認が必要な点を明示します。",
    confidence: "medium", status: "approved",
    generation_method: "human",
    generated_at: snapshot.generatedAt, reviewed_at: snapshot.generatedAt,
    evidence: { summary: [{ text: "Official fact.", truncated: false }], impact: [{ text: "Official condition.", truncated: false }] },
  };
  assert.deepEqual(snapshotIssues({ ...snapshot, briefs: [brief] }), []);
  assert.ok(snapshotIssues({ ...snapshot, briefs: [{ ...brief, status: "draft" }] }).includes("invalid-brief-status"));
  assert.ok(snapshotIssues({ ...snapshot, briefs: [{ ...brief, generation_method: "automatic" }] }).includes("invalid-brief-status"));
  assert.ok(snapshotIssues({ ...snapshot, briefs: [{ ...brief, source_sha256: "f".repeat(64) }] }).includes("invalid-brief-source"));
  assert.ok(snapshotIssues({ ...snapshot, briefs: [{ ...brief, source_checked_at: "2026-01-01T00:00:00Z" }] }).includes("invalid-brief-source"));
  assert.ok(snapshotIssues({ ...snapshot, briefs: [{ ...brief, summary_ja: "<script>危険</script>" }] }).includes("invalid-brief-copy"));
  assert.ok(snapshotIssues({ ...snapshot, briefs: [{ ...brief, evidence: { summary: [], impact: brief.evidence.impact } }] }).includes("invalid-brief-evidence"));
  assert.ok(snapshotIssues({ ...snapshot, briefs: [{ ...brief, evidence: { summary: [{ text: "x".repeat(321), truncated: true }], impact: brief.evidence.impact } }] }).includes("invalid-brief-evidence"));
  assert.ok(snapshotIssues({ ...snapshot, briefs: [{ ...brief, reviewed_at: "2099-01-01T00:00:00Z" }] }).includes("invalid-brief-time"));
});

test("operations preview renders only reviewed briefs with evidence and review metadata", () => {
  assert.match(intakeDashboard, /人間確認済みの速報要約/);
  assert.match(intakeDashboard, /根拠となる公式原文/);
  assert.match(intakeDashboard, /編集確認（JST）/);
  assert.match(intakeDashboard, /公式原文の最終確認（JST）/);
  assert.match(intakeDashboard, /下書き作成（JST）/);
  assert.match(intakeDashboard, /AI下書き＋人間確認/);
  assert.match(intakeDashboard, /人間作成/);
  assert.match(intakeDashboard, /確信度/);
  assert.match(intakeDashboard, /原文識別値/);
  assert.match(intakeDashboard, /照合した公式原文の抜粋/);
  assert.match(intakeDashboard, /事実要約の根拠/);
  assert.match(intakeDashboard, /影響判断の根拠/);
  assert.doesNotMatch(intakeDashboard, /brief\.reviewer|brief\.reviewReason/);
});

test("sector and company filters use the shared registry", () => {
  assert.equal(providers.length, 22);
  const sector = providerByTicker[source.ticker].sector;
  assert.equal(filterSources([source], providerByTicker[source.ticker].name, "all", "all", "all", {}, sector).length, 1);
  assert.equal(filterSources([source], "", "all", "all", "all", {}, "not-a-sector").length, 0);
});

test("coverage uses the latest run and never counts untested companies as failures", () => {
  const counts = coverageCounts({ ...snapshot, discoveryRuns: [
    { id: 1, ticker: "NVDA", status: "ok" },
    { id: 3, ticker: "NVDA", status: "degraded" },
    { id: 2, ticker: "AMD", status: "ok" },
    { id: 4, ticker: "TSM", status: "fallback" },
  ] });
  assert.deepEqual(counts, { registered: 22, discovered: 2, needsCheck: 1, untested: 19 });
});

test("every registered company has a valid company coverage page model", () => {
  const companies = buildCoverageCompanies(snapshot);
  assert.equal(companies.length, 22);
  assert.deepEqual(coverageCompanyIssues(companies), []);
  assert.equal(companies.find((company) => company.ticker === "NVDA").counts.total, 20);
  assert.equal(companies.find((company) => company.ticker === "CRWV").counts.fetched, 1);
  assert.ok(["fallback", "degraded"].includes(companies.find((company) => company.ticker === "ORCL").discovery.status));
});
