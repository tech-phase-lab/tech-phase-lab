"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import type { BusinessSection, RiskSection } from "@/lib/research/stock-directory";
import { annualDraftGenerationMethod, annualReviewPreflight, businessDraftEvidence, referencedQuotes } from "@/lib/research/annual-draft-evidence";
import styles from "./review.module.css";

type Evidence = { summary: string[]; impact: string[] };
type ReviewHistory = {
  source_sha256: string; draft_validation_sha256: string | null;
  decision: "approved" | "held" | "rejected";
  reviewed_at: string; reviewer: string; reason: string; current_revision: boolean;
};
type ReviewCounts = {
  total: number; needs_draft: number; awaiting_review: number; stale: number;
  held: number; approved: number; rejected: number; machine_ready: number; machine_blocked: number;
};
type ReviewFilter = "all" | "ready" | "blocked" | "needs-draft";
type RevisionEvidence = {
  previous_sha256: string; previous_observed_at: string; current_sha256: string;
  diff_preview: string; truncated: boolean; method: "word-diff";
};
type PreviousBrief = {
  source_sha256: string; summary_ja: string; impact_label: string; impact_ja: string;
  confidence: string; generated_at: string; evidence: Evidence;
};
type ReviewItem = {
  url: string; ticker: string; title: string | null; published_on: string | null; discovered_at: string;
  checked_at: string; sha256: string; source_text: string; source_text_truncated: boolean;
  brief_current: boolean; draft_validation_sha256: string | null;
  review_history?: ReviewHistory[]; revision_evidence?: RevisionEvidence | null;
  previous_brief?: PreviousBrief | null;
  summary_ja: string | null; impact_label: string | null; impact_ja: string | null; confidence: string | null;
  brief_status: string | null; generated_at: string | null; reviewed_at: string | null; evidence: Evidence;
  review_preflight: { ready: boolean; blockers: string[]; checks: string[] };
  generation_provider: string | null; generation_model: string | null; generation_response_id: string | null;
  generation_source_truncated: number; generation_input_tokens: number | null;
  generation_output_tokens: number | null; generation_total_tokens: number | null;
  generation_job_status: string | null; generation_job_attempts: number | null;
  generation_job_next_attempt_at: string | null; generation_job_error: string | null;
  generation_job_reserved_tokens: number | null;
};
type AnnualRecord = {
  id: string; ticker: string; accessionNumber: string; sourceSha256: string;
  summaryJa: string; businessModelJa: string;
  riskPointsJa: { text: string; evidenceIds: string[] }[];
  summaryEvidenceIds: string[]; businessModelEvidenceIds: string[];
  evidence: { id: string; section: "business" | "risk"; quote: string }[];
  confidence: "low" | "medium" | "high"; generationMethod: "human" | "ai-assisted";
  status: "draft" | "approved" | "held" | "rejected";
  validationSha256: string | null;
  generatedAt: string; reviewedAt: string | null; reviewer: string | null; reviewReason: string | null;
  reviewHistory?: {
    sourceSha256: string; draftValidationSha256: string | null;
    decision: "approved" | "held" | "rejected"; reviewedAt: string;
    reviewer: string; reason: string; currentRevision: boolean;
  }[];
};
type AnnualSource = { business: BusinessSection | null; risks: RiskSection | null };
type AnnualSourceResponse = AnnualSource & { ok: boolean; error?: string };
type AnnualRiskDraft = { text: string; evidence: string[] };

const labels: Record<string, string> = { draft: "下書き", approved: "承認済み", held: "保留", rejected: "却下", stale: "原文変更・再確認" };
const jobLabels: Record<string, string> = {
  "waiting-body": "原文取得待ち", queued: "AI生成待ち", running: "AI生成中", retry: "AI再試行待ち",
  succeeded: "AI下書き生成済み", failed: "AI生成停止",
};
const preflightLabels: Record<string, string> = {
  "draft-missing": "現在の原文に対応する下書きがありません",
  "source-revision-mismatch": "下書き作成後に公式原文が更新されました",
  "source-unavailable": "公式原文の最新取得を確認できません",
  "source-check-stale": "公式原文の最終取得が古いため、再取得後に確認してください",
  "draft-evidence-invalid": "根拠引用または数値根拠を再確認してください",
  "draft-fingerprint-missing": "旧形式の下書きです。現在の原文から再保存してください",
  "draft-fingerprint-mismatch": "保存後に下書きまたは根拠が変更されています",
  "annual-draft-missing": "現在のSEC原文に対応する下書きがありません",
  "annual-source-unavailable": "SEC原文の事業説明とリスク項目を確認できません",
  "annual-source-revision-mismatch": "下書き作成後にSEC原文が更新されました",
  "annual-draft-fingerprint-missing": "旧形式の下書きです。現在のSEC原文から再保存してください",
  "annual-draft-evidence-invalid": "根拠の参照関係を再確認してください",
  "annual-business-evidence-mismatch": "企業要点または収益構造の根拠が表示中のSEC原文と一致しません",
  "annual-risk-evidence-mismatch": "リスク根拠が表示中のSEC原文と一致しません",
};
const splitEvidence = (value: string) => value.split(/\n{2,}/).map(v => v.trim()).filter(Boolean);
const riskCorpus = (risks: RiskSection | null) => [
  risks?.excerpt ?? "",
  risks?.overview?.groups.flatMap(group => [group.heading ?? "", ...group.items]).join("\n") ?? "",
].filter(Boolean).join("\n");
const emptyAnnualRisk = (): AnnualRiskDraft => ({ text: "", evidence: [""] });
const emptyReviewCounts: ReviewCounts = {
  total: 0, needs_draft: 0, awaiting_review: 0, stale: 0, held: 0, approved: 0, rejected: 0,
  machine_ready: 0, machine_blocked: 0,
};
const reviewFilters: { value: ReviewFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "ready", label: "機械検証通過" },
  { value: "blocked", label: "要修正" },
  { value: "needs-draft", label: "下書き未作成" },
];

function annualRiskDrafts(record: AnnualRecord | null): AnnualRiskDraft[] {
  if (!record?.riskPointsJa.length) return [emptyAnnualRisk()];
  const evidence = new Map(record.evidence.map(item => [item.id, item]));
  return record.riskPointsJa.map(point => ({
    text: point.text,
    evidence: point.evidenceIds.map(id => evidence.get(id)?.quote).filter((quote): quote is string => Boolean(quote)).slice(0, 4),
  })).map(point => point.evidence.length ? point : { ...point, evidence: [""] });
}

export default function ReviewDashboard() {
  const [token, setToken] = useState("");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [reviewCounts, setReviewCounts] = useState<ReviewCounts>(emptyReviewCounts);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [selectedUrl, setSelectedUrl] = useState("");
  const [message, setMessage] = useState("編集用トークンを入力してください。ブラウザーには保存しません。");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"news" | "annual">("news");
  const [annualTicker, setAnnualTicker] = useState("NVDA");
  const [annualSource, setAnnualSource] = useState<AnnualSource | null>(null);
  const [annualRecord, setAnnualRecord] = useState<AnnualRecord | null>(null);
  const [annualRisks, setAnnualRisks] = useState<AnnualRiskDraft[]>([emptyAnnualRisk()]);
  const selected = useMemo(() => items.find(item => item.url === selectedUrl) ?? items[0], [items, selectedUrl]);
  const selectedReviewHistory = selected?.review_history ?? [];
  const annualSummaryEvidence = annualRecord ? referencedQuotes(annualRecord.evidence, annualRecord.summaryEvidenceIds).join("\n\n") : "";
  const annualBusinessEvidence = annualRecord ? referencedQuotes(annualRecord.evidence, annualRecord.businessModelEvidenceIds).join("\n\n") : "";
  const annualReviewHistory = annualRecord?.reviewHistory ?? [];
  const annualPreflight = useMemo(() => annualReviewPreflight(
    annualRecord,
    annualSource?.business ?? null,
    annualSource?.risks ?? null,
    riskCorpus(annualSource?.risks ?? null),
  ), [annualRecord, annualSource]);

  async function request(method: "GET" | "POST", body?: unknown, kind: "news" | "annual" = "news", filter: ReviewFilter = reviewFilter) {
    const params = new URLSearchParams({ limit: String(kind === "annual" ? 50 : 30) });
    if (kind === "annual") params.set("kind", "annual");
    else params.set("view", filter);
    const result = await fetch(`/api/research/editor?${params}`, {
      method,
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await result.json();
    if (!result.ok || !payload.ok) throw new Error(payload.error || "request-failed");
    return payload;
  }

  async function load(successMessage?: string, filter: ReviewFilter = reviewFilter) {
    setBusy(true);
    try {
      const payload = await request("GET", undefined, "news", filter);
      setItems(payload.items);
      setReviewCounts(payload.counts ?? emptyReviewCounts);
      setReviewFilter(filter);
      setFilteredTotal(payload.filteredTotal ?? payload.items.length);
      setSelectedUrl(current => payload.items.some((item: ReviewItem) => item.url === current) ? current : payload.items[0]?.url ?? "");
      setMode("news");
      setMessage(successMessage ?? `絞り込み対象 ${payload.filteredTotal ?? payload.items.length}件から、対応優先順に${payload.items.length}件を読み込みました。`);
    } catch (error) {
      setMessage(`読み込み失敗：${error instanceof Error ? error.message : "unknown"}`);
    } finally { setBusy(false); }
  }

  async function loadAnnual(successMessage?: string) {
    const ticker = annualTicker.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker)) {
      setMessage("年次報告書の読み込み失敗：ティッカー形式を確認してください。");
      return;
    }
    setBusy(true);
    try {
      const [queue, sourceResponse] = await Promise.all([
        request("GET", undefined, "annual"),
        fetch(`/api/research/stocks?ticker=${encodeURIComponent(ticker)}&view=business`, { cache: "no-store" }),
      ]);
      const source = await sourceResponse.json() as AnnualSourceResponse;
      if (!sourceResponse.ok || !source.ok || !source.business || !source.risks) {
        throw new Error(source.error || "annual-sections-unavailable");
      }
      if (source.business.ticker !== ticker || source.risks.ticker !== ticker
          || source.business.accessionNumber !== source.risks.accessionNumber
          || source.business.sourceSha256 !== source.risks.sourceSha256) {
        throw new Error("annual-source-identity-mismatch");
      }
      const existing = (queue.items as AnnualRecord[]).find(item =>
        item.ticker === ticker && item.accessionNumber === source.business?.accessionNumber
      ) ?? null;
      const currentRecord = existing?.sourceSha256 === source.business.sourceSha256 ? existing : null;
      setAnnualTicker(ticker);
      setAnnualSource({ business: source.business, risks: source.risks });
      setAnnualRecord(currentRecord);
      setAnnualRisks(annualRiskDrafts(currentRecord));
      setMode("annual");
      setMessage(successMessage ?? (existing && !currentRecord
        ? `${ticker}のSEC原文が保存済み下書きから更新されています。以前の内容は読み込まず、新しいSHAで再作成してください。`
        : `${ticker}の年次報告書と${currentRecord ? "保存済み下書き" : "SEC原文"}を読み込みました。`));
    } catch (error) {
      setAnnualSource(null);
      setAnnualRecord(null);
      setAnnualRisks([emptyAnnualRisk()]);
      setMessage(`年次報告書の読み込み失敗：${error instanceof Error ? error.message : "unknown"}`);
    } finally { setBusy(false); }
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await request("POST", { action: "draft", payload: {
        url: selected.url,
        sha256: selected.sha256,
        summaryJa: form.get("summaryJa"),
        impactLabel: form.get("impactLabel"),
        impactJa: form.get("impactJa"),
        confidence: form.get("confidence"),
        evidence: {
          summary: splitEvidence(String(form.get("summaryEvidence") ?? "")),
          impact: splitEvidence(String(form.get("impactEvidence") ?? "")),
        },
      } });
      await load("根拠付き下書きを保存しました。まだ公開・配信されていません。");
    } catch (error) {
      setMessage(`保存失敗：${error instanceof Error ? error.message : "unknown"}`);
    } finally { setBusy(false); }
  }

  async function generateDraft() {
    if (!selected) return;
    setBusy(true);
    try {
      await request("POST", { action: "generate", payload: { url: selected.url, sha256: selected.sha256 } });
      await load("AI下書きを生成し、原文根拠の機械照合を通過しました。まだ公開・配信されていません。");
    } catch (error) {
      const code = error instanceof Error ? error.message : "unknown";
      const friendly: Record<string, string> = {
        "generation-not-configured": "生成機能は未設定です。APIキーと使用モデルを設定するまで課金・生成は行われません。",
        "generation-daily-limit-reached": "直近24時間の生成回数上限に達したため、外部送信前に停止しました。",
        "generation-token-budget-exhausted": "直近24時間のトークン予算が不足しているため、外部送信前に停止しました。",
      };
      setMessage(friendly[code] ?? `生成失敗：${code}`);
    } finally { setBusy(false); }
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected?.draft_validation_sha256) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await request("POST", { action: "review", payload: {
        url: selected.url,
        sha256: selected.sha256,
        validationSha256: selected.draft_validation_sha256,
        decision: form.get("decision"),
        reviewer: form.get("reviewer"),
        reason: form.get("reason"),
      } });
      await load("人間の判断を記録しました。承認しても会員への自動配信は行いません。");
    } catch (error) {
      const code = error instanceof Error ? error.message : "unknown";
      if (code === "draft-revision-mismatch") {
        await load("別の編集者が下書きを更新したため、最新版を再読み込みしました。内容を確認し直してください。");
      } else {
        setMessage(`判断の保存失敗：${code}`);
      }
    } finally { setBusy(false); }
  }

  async function submitAnnualDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!annualSource?.business || !annualSource.risks) return;
    const form = new FormData(event.currentTarget);
    const { business, risks } = annualSource;
    const riskPointsJa = annualRisks.map((risk, riskIndex) => ({
      text: risk.text,
      evidenceIds: risk.evidence.map((_, evidenceIndex) => `risk-${riskIndex + 1}-${evidenceIndex + 1}`),
    }));
    const riskEvidence = annualRisks.flatMap((risk, riskIndex) => risk.evidence.map((quote, evidenceIndex) => ({
      id: `risk-${riskIndex + 1}-${evidenceIndex + 1}`,
      section: "risk",
      quote: quote.trim(),
    })));
    setBusy(true);
    try {
      const businessEvidence = businessDraftEvidence(
        splitEvidence(String(form.get("summaryEvidence") ?? "")),
        splitEvidence(String(form.get("businessEvidence") ?? "")),
      );
      if (businessEvidence.evidence.length + riskEvidence.length > 12) throw new Error("根拠引用は事業・リスクを合わせて最大12件です。");
      await request("POST", { action: "annual-draft", payload: {
        id: `${business.ticker.toLowerCase()}-${business.accessionNumber.replaceAll("-", "")}-ja`,
        ticker: business.ticker,
        accessionNumber: business.accessionNumber,
        sourceSha256: business.sourceSha256,
        summaryJa: form.get("summaryJa"),
        businessModelJa: form.get("businessModelJa"),
        riskPointsJa,
        summaryEvidenceIds: businessEvidence.summaryEvidenceIds,
        businessModelEvidenceIds: businessEvidence.businessModelEvidenceIds,
        evidence: [
          ...businessEvidence.evidence,
          ...riskEvidence,
        ],
        confidence: form.get("confidence"),
        generationMethod: annualDraftGenerationMethod(form.get("generationMethod"), annualRecord?.generationMethod),
        sourceBusiness: business.excerpt,
        sourceRisks: riskCorpus(risks),
      } }, "annual");
      await loadAnnual("年次報告書の根拠付き下書きを保存しました。人間が承認するまで公開されません。");
    } catch (error) {
      setMessage(`年次報告書の保存失敗：${error instanceof Error ? error.message : "unknown"}`);
    } finally { setBusy(false); }
  }

  async function submitAnnualReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!annualSource?.business || !annualRecord?.validationSha256) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await request("POST", { action: "annual-review", payload: {
        ticker: annualSource.business.ticker,
        accessionNumber: annualSource.business.accessionNumber,
        sourceSha256: annualSource.business.sourceSha256,
        validationSha256: annualRecord.validationSha256,
        sourceBusiness: annualSource.business.excerpt,
        sourceRisks: riskCorpus(annualSource.risks),
        decision: form.get("decision"),
        reviewer: form.get("reviewer"),
        reason: form.get("reason"),
      } }, "annual");
      await loadAnnual("年次報告書の人間判断を記録しました。承認後も会員通知や外部配信は行いません。");
    } catch (error) {
      const code = error instanceof Error ? error.message : "unknown";
      if (code === "annual-draft-revision-mismatch") {
        await loadAnnual("別の編集者が年次報告書の下書きを更新したため、最新版を再読み込みしました。内容を確認し直してください。");
      } else if ([
        "annual-review-source-invalid", "annual-review-source-too-large",
        "annual-review-evidence-mismatch",
      ].includes(code)) {
        await loadAnnual("判断前のSEC抜粋照合に失敗したため、原文と下書きを再読み込みしました。根拠を確認し直してください。");
      } else {
        setMessage(`年次報告書の判断保存失敗：${code}`);
      }
    } finally { setBusy(false); }
  }

  return <main className={styles.main}>
    <header><div><p>TECH PHASE · PRIVATE EDITOR</p><h1>根拠付きリサーチレビュー</h1></div><Link href="/research/intake">取得状況へ戻る</Link></header>
    <aside className={styles.warning}><strong>配信前の運営画面</strong><span>原文・数値・解釈を人間が確認するための画面です。承認操作だけで会員へ配信されることはありません。</span></aside>
    <section className={styles.auth} aria-label="編集者認証"><label>編集用トークン<input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} /></label><div className={styles.authActions}><button disabled={busy || token.length < 24} onClick={() => load()}>速報原文を読み込む</button><div className={styles.tickerLoad}><input aria-label="年次報告書のティッカー" value={annualTicker} maxLength={15} onChange={event => setAnnualTicker(event.target.value.toUpperCase())} /><button disabled={busy || token.length < 24} onClick={() => loadAnnual()}>年次報告書を開く</button></div></div><p aria-live="polite">{message}</p></section>
    {(reviewCounts.total > 0 || items.length > 0 || annualSource) && <div className={styles.modeTabs} role="tablist" aria-label="レビュー対象"><button role="tab" aria-selected={mode === "news"} disabled={!reviewCounts.total && !items.length} onClick={() => setMode("news")}>速報レビュー</button><button role="tab" aria-selected={mode === "annual"} disabled={!annualSource} onClick={() => setMode("annual")}>年次報告書レビュー</button></div>}
    {mode === "news" && (reviewCounts.total > 0 || items.length > 0) && <div className={styles.workspace}>
      <nav aria-label="確認する原文"><h2>速報レビューキュー</h2><div className={styles.annualMeta} aria-label="レビュー状況"><span>機械検証通過 {reviewCounts.machine_ready}</span><span>要修正 {reviewCounts.machine_blocked}</span><span>承認待ち {reviewCounts.awaiting_review}</span><span>原文更新 {reviewCounts.stale}</span><span>保留 {reviewCounts.held}</span><span>下書き未作成 {reviewCounts.needs_draft}</span><span>承認済み {reviewCounts.approved}</span></div><p style={{ margin: "10px 0 12px", color: "#81968f", fontSize: 12, lineHeight: 1.55 }}>機械検証通過は、人間が内容を確認できる状態の件数です。承認済み・下書き未作成は含みません。</p><div className={styles.queueFilters} aria-label="レビューキューの絞り込み">{reviewFilters.map(filter => <button key={filter.value} type="button" aria-pressed={reviewFilter === filter.value} disabled={busy} onClick={() => load(undefined, filter.value)}>{filter.label}</button>)}</div><p className={styles.filterResult}>{filteredTotal}件中 {items.length}件を表示</p>{items.length ? items.map(item => <button key={item.url} aria-current={selected?.url === item.url} onClick={() => setSelectedUrl(item.url)}><b>{item.ticker}</b><span>{item.title || new URL(item.url).pathname.split("/").filter(Boolean).at(-1)}</span><small>{labels[item.brief_status ?? ""] ?? "下書きなし"}{item.brief_status && item.brief_status !== "approved" ? ` · ${item.review_preflight.ready ? "機械検証通過" : "要修正"}` : ""}</small></button>) : <p className={styles.filterResult}>該当する資料はありません。</p>}</nav>
      {selected && <article className={styles.editor}>
        <div className={styles.sourceHead}><div><p>{selected.ticker} · SHA {selected.sha256.slice(0, 12)}…</p><h2>{selected.title || "公式原文"}</h2></div><a href={selected.url} target="_blank" rel="noopener noreferrer">公式原文 ↗</a></div>
        {selected.brief_status === "stale" && !selected.brief_current && <aside className={styles.warning}><strong>原文が更新されました</strong><span>旧要約と旧根拠はフォームへ読み戻していません。現在の原文から下書きを作り直してください。</span></aside>}
        {selected.revision_evidence && <details open className={`${styles.evidence} ${styles.revisionDiff}`}><summary>前回取得版からの機械差分</summary><div className={styles.diffMeta}><span>旧 {selected.revision_evidence.previous_sha256.slice(0, 12)}…</span><span>現 {selected.revision_evidence.current_sha256.slice(0, 12)}…</span></div>{selected.revision_evidence.diff_preview ? <pre>{selected.revision_evidence.diff_preview}</pre> : <p>本文の文字列差分は検出されませんでした。HTMLなど本文外の応答が変わった可能性があります。</p>}<p>文字列の機械比較です。訂正理由や意味、重要度は自動判定していません。公式原文を確認してください。{selected.revision_evidence.truncated ? " 差分表示は6,000文字で打ち切っています。" : ""}</p></details>}
        {selected.previous_brief && <details className={`${styles.evidence} ${styles.revisionDiff}`}><summary>失効した以前の下書き（参考・再利用不可）</summary><div className={styles.diffMeta}><span>旧原文 {selected.previous_brief.source_sha256.slice(0, 12)}…</span><span>{selected.previous_brief.impact_label} · 確信度 {selected.previous_brief.confidence}</span></div><h3>事実要約</h3><p>{selected.previous_brief.summary_ja}</p><h3>影響と未確認事項</h3><p>{selected.previous_brief.impact_ja}</p><div className={styles.annualEvidenceGrid}><div><strong>旧要約の根拠</strong><pre>{selected.previous_brief.evidence.summary.join("\n\n")}</pre></div><div><strong>旧影響判定の根拠</strong><pre>{selected.previous_brief.evidence.impact.join("\n\n")}</pre></div></div><p>保持した旧原文との完全一致と下書き指紋を再検証できた場合だけ表示します。編集フォームには転記していません。現行原文と差分を確認して、新しく作成してください。</p></details>}
        <details open className={styles.evidence}><summary>取得した原文証拠（{selected.source_text.length.toLocaleString("ja-JP")}文字）</summary><pre>{selected.source_text}</pre>{selected.source_text_truncated && <p>画面表示は80,000文字で打ち切っています。承認前に公式原文も確認してください。</p>}</details>
        <section className={styles.form}><div><h2>AIによる根拠付き下書き</h2><p>設定済みの場合だけ1件生成します。現在の原文・完全一致する根拠抜粋・数値照合を通過しない限り保存されません。</p>{selected.generation_job_status && <small>自動処理：{jobLabels[selected.generation_job_status] ?? selected.generation_job_status} · 試行 {selected.generation_job_attempts ?? 0}回{selected.generation_job_error ? ` · ${selected.generation_job_error}` : ""}</small>}{selected.generation_model && <small>生成記録：{selected.generation_provider} · {selected.generation_model}{selected.generation_total_tokens != null ? ` · ${selected.generation_total_tokens.toLocaleString("ja-JP")} tokens` : " · 使用量未取得"}{selected.generation_source_truncated ? " · 入力上限のため原文を短縮" : ""}</small>}</div><button type="button" disabled={busy} onClick={generateDraft}>AI下書きを生成</button></section>
        <form key={`${selected.url}-draft-${selected.sha256}-${selected.generated_at}`} onSubmit={submitDraft} className={styles.form}><h2>日本語速報の下書き</h2>
          <label>事実要約<textarea name="summaryJa" minLength={20} maxLength={600} required defaultValue={selected.summary_ja ?? ""} /></label>
          <label>要約の根拠抜粋<textarea name="summaryEvidence" required defaultValue={selected.evidence.summary.join("\n\n")} /><small>原文に完全一致する抜粋。複数は空行で区切ります。</small></label>
          <div className={styles.row}><label>影響分類<select name="impactLabel" defaultValue={selected.impact_label ?? "uncertain"}><option value="positive">positive</option><option value="negative">negative</option><option value="mixed">mixed</option><option value="neutral">neutral</option><option value="uncertain">uncertain</option></select></label><label>確信度<select name="confidence" defaultValue={selected.confidence ?? "low"}><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label></div>
          <label>影響と未確認事項<textarea name="impactJa" minLength={20} maxLength={900} required defaultValue={selected.impact_ja ?? ""} /></label>
          <label>影響判定の根拠抜粋<textarea name="impactEvidence" required defaultValue={selected.evidence.impact.join("\n\n")} /></label>
          <button disabled={busy}>根拠付き下書きを保存</button>
        </form>
        <form onSubmit={submitReview} className={styles.form}><h2>人間による最終判断</h2><p>現在：{labels[selected.brief_status ?? ""] ?? "下書きなし"}{selected.brief_status && !selected.brief_current ? " · 新しい下書き保存後に判断できます" : ""}。画面に表示した下書き指紋も判断時に再照合します。</p>
          <aside className={styles.warning}>
            <strong>{selected.review_preflight.ready ? "承認前の機械検証：通過" : "承認前の機械検証：要修正"}</strong>
            {selected.review_preflight.ready
              ? <span>原文SHA・最新取得・根拠引用・数値根拠・下書き指紋が一致しています。これは人間による内容確認の代わりではありません。</span>
              : <ul>{selected.review_preflight.blockers.map(code => <li key={code}>{preflightLabels[code] ?? "下書きを現在の原文から再保存してください"}</li>)}</ul>}
          </aside>
          <div className={styles.row}><label>判断<select name="decision"><option value="held">保留</option><option value="approved">承認</option><option value="rejected">却下</option></select></label><label>確認者<input name="reviewer" required minLength={2} /></label></div>
          <label>判断理由<textarea name="reason" required minLength={5} /></label><button disabled={busy || !selected.review_preflight.ready || !selected.draft_validation_sha256}>判断を記録</button>
        </form>
        {selectedReviewHistory.length > 0 && <details className={styles.evidence}><summary>判断履歴（直近{selectedReviewHistory.length}件）</summary><ol>{selectedReviewHistory.map((entry, index) => <li key={`${entry.reviewed_at}-${index}`}><div><b>{labels[entry.decision]}</b><span>{entry.reviewed_at.replace("T", " ").replace("+00:00", " UTC")} · {entry.reviewer}{entry.current_revision ? " · 現在の下書き" : " · 過去の下書き"}</span></div><p>{entry.reason}</p><small>原文 {entry.source_sha256.slice(0, 12)}…{entry.draft_validation_sha256 ? ` · 下書き ${entry.draft_validation_sha256.slice(0, 12)}…` : " · 旧履歴（下書き指紋なし）"}</small></li>)}</ol></details>}
      </article>}
    </div>}
    {mode === "annual" && annualSource?.business && annualSource.risks && <article className={`${styles.editor} ${styles.annualEditor}`}>
      <div className={styles.sourceHead}><div><p>{annualSource.business.ticker} · {annualSource.business.form} · SHA {annualSource.business.sourceSha256.slice(0, 12)}…</p><h2>年次報告書の日本語要点</h2></div><a href={annualSource.business.documentUrl} target="_blank" rel="noopener noreferrer">SEC原文 ↗</a></div>
      <div className={styles.annualMeta}><span>提出日 {annualSource.business.filingDate}</span><span>対象期末 {annualSource.business.reportDate ?? "未記載"}</span><span>提出番号 {annualSource.business.accessionNumber}</span><span>現在：{labels[annualRecord?.status ?? ""] ?? "下書きなし"}</span></div>
      <div className={styles.annualEvidenceGrid}>
        <details open className={styles.evidence}><summary>事業説明のSEC原文（{annualSource.business.excerpt.length.toLocaleString("ja-JP")}文字）</summary><pre>{annualSource.business.excerpt}</pre></details>
        <details open className={styles.evidence}><summary>リスク項目のSEC原文（{annualSource.risks.excerpt.length.toLocaleString("ja-JP")}文字）</summary><pre>{annualSource.risks.excerpt}</pre></details>
      </div>
      <form key={`${annualSource.business.accessionNumber}-${annualRecord?.generatedAt ?? "new"}`} onSubmit={submitAnnualDraft} className={styles.form}><h2>根拠付き日本語要点の下書き</h2><p>英語原文から完全一致する引用を選びます。作成方法を記録し、人間による内容確認と承認を経て公開します。この画面でAI生成は実行しません。</p>
        <label>下書きの作成方法<select name="generationMethod" required defaultValue={annualRecord?.generationMethod ?? ""}><option value="" disabled>作成方法を選択</option><option value="human" disabled={annualRecord?.generationMethod === "ai-assisted"}>人間が作成（AI補助なし）</option><option value="ai-assisted">AI補助あり（翻訳・要約を含む）</option></select><small>外部のAIで作成した文章を貼り付けた場合も「AI補助あり」を選びます。AI補助の下書きは、人間が編集しても作成履歴を保持します。</small></label>
        <label>企業の要点<textarea name="summaryJa" minLength={20} maxLength={500} required defaultValue={annualRecord?.summaryJa ?? ""} /></label>
        <label>何で稼ぐ会社か<textarea name="businessModelJa" minLength={20} maxLength={800} required defaultValue={annualRecord?.businessModelJa ?? ""} /></label>
        <label>企業の要点の根拠引用<textarea name="summaryEvidence" minLength={24} maxLength={6414} required defaultValue={annualSummaryEvidence} /><small>上の事業説明から完全一致する引用を選びます。1件24〜800文字、複数の引用は空行で区切り、最大8件です。</small></label>
        <label>何で稼ぐ会社かの根拠引用<textarea name="businessEvidence" minLength={24} maxLength={6414} required defaultValue={annualBusinessEvidence} /><small>企業の要点とは別に根拠を指定できます。1件24〜800文字、空行区切りで最大8件。同じ引用はまとめ、リスクを含め全体で最大12件です。</small></label>
        <section className={styles.riskEditor} aria-label="重要リスクの編集">
          <div className={styles.riskEditorHead}><div><h3>重要リスク</h3><p>各項目を別々のSEC原文引用へ結び付けます。最大6項目、1項目につき根拠は最大4件です。</p></div><button type="button" disabled={busy || annualRisks.length >= 6} onClick={() => setAnnualRisks(current => [...current, emptyAnnualRisk()])}>リスクを追加</button></div>
          {annualRisks.map((risk, riskIndex) => <fieldset key={`annual-risk-${riskIndex}`} className={styles.riskItem}>
            <legend>リスク {riskIndex + 1}</legend>
            <label>日本語要点<textarea aria-label={`リスク ${riskIndex + 1} の日本語要点`} minLength={12} maxLength={360} required value={risk.text} onChange={event => setAnnualRisks(current => current.map((item, index) => index === riskIndex ? { ...item, text: event.target.value } : item))} /></label>
            {risk.evidence.map((quote, evidenceIndex) => <div key={`annual-risk-${riskIndex}-evidence-${evidenceIndex}`} className={styles.riskEvidenceRow}>
              <label>根拠引用 {evidenceIndex + 1}<textarea aria-label={`リスク ${riskIndex + 1} の根拠引用 ${evidenceIndex + 1}`} minLength={24} maxLength={800} required value={quote} onChange={event => setAnnualRisks(current => current.map((item, index) => index === riskIndex ? { ...item, evidence: item.evidence.map((value, quoteIndex) => quoteIndex === evidenceIndex ? event.target.value : value) } : item))} /><small>上のリスク原文に完全一致する24〜800文字。原文にない数値を日本語へ追加すると保存を拒否します。</small></label>
              {risk.evidence.length > 1 && <button type="button" className={styles.quietButton} onClick={() => setAnnualRisks(current => current.map((item, index) => index === riskIndex ? { ...item, evidence: item.evidence.filter((_, quoteIndex) => quoteIndex !== evidenceIndex) } : item))}>この引用を削除</button>}
            </div>)}
            <div className={styles.riskActions}><button type="button" className={styles.quietButton} disabled={busy || risk.evidence.length >= 4 || annualRisks.reduce((total, item) => total + item.evidence.length, 0) >= 11} onClick={() => setAnnualRisks(current => current.map((item, index) => index === riskIndex ? { ...item, evidence: [...item.evidence, ""] } : item))}>根拠引用を追加</button>{annualRisks.length > 1 && <button type="button" className={styles.dangerButton} onClick={() => setAnnualRisks(current => current.filter((_, index) => index !== riskIndex))}>このリスクを削除</button>}</div>
          </fieldset>)}
        </section>
        <label>確信度<select name="confidence" defaultValue={annualRecord?.confidence ?? "low"}><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label>
        <button disabled={busy}>年次報告書の下書きを保存</button>
      </form>
      <form onSubmit={submitAnnualReview} className={styles.form}><h2>人間による最終判断</h2><p>SEC原文・提出番号・SHA・根拠引用・数値を確認してから判断します。画面に表示した下書き指紋とSEC抜粋も判断時に再照合し、原文更新時は公開側で自動失効します。</p>
        <aside className={styles.warning}>
          <strong>{annualPreflight.ready ? "承認前の機械検証：通過" : "承認前の機械検証：要修正"}</strong>
          {annualPreflight.ready
            ? <span>提出番号・原文SHA・下書き指紋・根拠参照・表示中のSEC抜粋が一致しています。これは人間による内容確認の代わりではありません。</span>
            : <ul>{annualPreflight.blockers.map(code => <li key={code}>{preflightLabels[code] ?? "現在のSEC原文から下書きを再保存してください"}</li>)}</ul>}
        </aside>
        <div className={styles.row}><label>判断<select name="decision"><option value="held">保留</option><option value="approved">承認</option><option value="rejected">却下</option></select></label><label>確認者<input name="reviewer" required minLength={2} /></label></div>
        <label>判断理由<textarea name="reason" required minLength={5} maxLength={500} /></label><button disabled={busy || !annualPreflight.ready}>判断を記録</button>
      </form>
      {annualReviewHistory.length > 0 && <details className={styles.evidence}><summary>年次報告書の判断履歴（直近{annualReviewHistory.length}件）</summary><ol>{annualReviewHistory.map((entry, index) => <li key={`${entry.reviewedAt}-${index}`}><div><b>{labels[entry.decision]}</b><span>{entry.reviewedAt.replace("T", " ").replace("Z", " UTC")} · {entry.reviewer}{entry.currentRevision ? " · 現在の下書き" : " · 過去の下書き"}</span></div><p>{entry.reason}</p><small>原文 {entry.sourceSha256.slice(0, 12)}…{entry.draftValidationSha256 ? ` · 下書き ${entry.draftValidationSha256.slice(0, 12)}…` : " · 旧履歴（下書き指紋なし）"}</small></li>)}</ol></details>}
    </article>}
  </main>;
}
