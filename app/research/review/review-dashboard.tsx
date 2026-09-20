"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import type { BusinessSection, RiskSection } from "@/lib/research/stock-directory";
import styles from "./review.module.css";

type Evidence = { summary: string[]; impact: string[] };
type ReviewItem = {
  url: string; ticker: string; title: string | null; published_on: string | null; discovered_at: string;
  checked_at: string; sha256: string; source_text: string; source_text_truncated: boolean;
  summary_ja: string | null; impact_label: string | null; impact_ja: string | null; confidence: string | null;
  brief_status: string | null; generated_at: string | null; reviewed_at: string | null; evidence: Evidence;
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
  generatedAt: string; reviewedAt: string | null; reviewer: string | null; reviewReason: string | null;
};
type AnnualSource = { business: BusinessSection | null; risks: RiskSection | null };
type AnnualSourceResponse = AnnualSource & { ok: boolean; error?: string };

const labels: Record<string, string> = { draft: "下書き", approved: "承認済み", held: "保留", rejected: "却下", stale: "原文変更・再確認" };
const jobLabels: Record<string, string> = {
  "waiting-body": "原文取得待ち", queued: "AI生成待ち", running: "AI生成中", retry: "AI再試行待ち",
  succeeded: "AI下書き生成済み", failed: "AI生成停止",
};
const splitEvidence = (value: string) => value.split(/\n{2,}/).map(v => v.trim()).filter(Boolean);
const riskCorpus = (risks: RiskSection | null) => [
  risks?.excerpt ?? "",
  risks?.overview?.groups.flatMap(group => [group.heading ?? "", ...group.items]).join("\n") ?? "",
].filter(Boolean).join("\n");

export default function ReviewDashboard() {
  const [token, setToken] = useState("");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [selectedUrl, setSelectedUrl] = useState("");
  const [message, setMessage] = useState("編集用トークンを入力してください。ブラウザーには保存しません。");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"news" | "annual">("news");
  const [annualTicker, setAnnualTicker] = useState("NVDA");
  const [annualSource, setAnnualSource] = useState<AnnualSource | null>(null);
  const [annualRecord, setAnnualRecord] = useState<AnnualRecord | null>(null);
  const selected = useMemo(() => items.find(item => item.url === selectedUrl) ?? items[0], [items, selectedUrl]);
  const annualBusinessEvidence = annualRecord?.evidence.find(item => item.section === "business")?.quote ?? "";
  const annualRiskEvidence = annualRecord?.evidence.find(item => item.section === "risk")?.quote ?? "";

  async function request(method: "GET" | "POST", body?: unknown, kind: "news" | "annual" = "news") {
    const result = await fetch(`/api/research/editor?limit=${kind === "annual" ? 50 : 30}${kind === "annual" ? "&kind=annual" : ""}`, {
      method,
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await result.json();
    if (!result.ok || !payload.ok) throw new Error(payload.error || "request-failed");
    return payload;
  }

  async function load(successMessage?: string) {
    setBusy(true);
    try {
      const payload = await request("GET");
      setItems(payload.items);
      setSelectedUrl(current => payload.items.some((item: ReviewItem) => item.url === current) ? current : payload.items[0]?.url ?? "");
      setMode("news");
      setMessage(successMessage ?? `確認可能な原文 ${payload.items.length}件を読み込みました。`);
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
      setMode("annual");
      setMessage(successMessage ?? (existing && !currentRecord
        ? `${ticker}のSEC原文が保存済み下書きから更新されています。以前の内容は読み込まず、新しいSHAで再作成してください。`
        : `${ticker}の年次報告書と${currentRecord ? "保存済み下書き" : "SEC原文"}を読み込みました。`));
    } catch (error) {
      setAnnualSource(null);
      setAnnualRecord(null);
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
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await request("POST", { action: "review", payload: {
        url: selected.url,
        sha256: selected.sha256,
        decision: form.get("decision"),
        reviewer: form.get("reviewer"),
        reason: form.get("reason"),
      } });
      await load("人間の判断を記録しました。承認しても会員への自動配信は行いません。");
    } catch (error) {
      setMessage(`判断の保存失敗：${error instanceof Error ? error.message : "unknown"}`);
    } finally { setBusy(false); }
  }

  async function submitAnnualDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!annualSource?.business || !annualSource.risks) return;
    const form = new FormData(event.currentTarget);
    const businessEvidence = String(form.get("businessEvidence") ?? "").trim();
    const riskEvidence = String(form.get("riskEvidence") ?? "").trim();
    const { business, risks } = annualSource;
    setBusy(true);
    try {
      await request("POST", { action: "annual-draft", payload: {
        id: `${business.ticker.toLowerCase()}-${business.accessionNumber.replaceAll("-", "")}-ja`,
        ticker: business.ticker,
        accessionNumber: business.accessionNumber,
        sourceSha256: business.sourceSha256,
        summaryJa: form.get("summaryJa"),
        businessModelJa: form.get("businessModelJa"),
        riskPointsJa: [{ text: form.get("riskPointJa"), evidenceIds: ["risk-1"] }],
        summaryEvidenceIds: ["business-1"],
        businessModelEvidenceIds: ["business-1"],
        evidence: [
          { id: "business-1", section: "business", quote: businessEvidence },
          { id: "risk-1", section: "risk", quote: riskEvidence },
        ],
        confidence: form.get("confidence"),
        generationMethod: "human",
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
    if (!annualSource?.business || !annualRecord) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await request("POST", { action: "annual-review", payload: {
        ticker: annualSource.business.ticker,
        accessionNumber: annualSource.business.accessionNumber,
        sourceSha256: annualSource.business.sourceSha256,
        decision: form.get("decision"),
        reviewer: form.get("reviewer"),
        reason: form.get("reason"),
      } }, "annual");
      await loadAnnual("年次報告書の人間判断を記録しました。承認後も会員通知や外部配信は行いません。");
    } catch (error) {
      setMessage(`年次報告書の判断保存失敗：${error instanceof Error ? error.message : "unknown"}`);
    } finally { setBusy(false); }
  }

  return <main className={styles.main}>
    <header><div><p>TECH PHASE · PRIVATE EDITOR</p><h1>根拠付きリサーチレビュー</h1></div><Link href="/research/intake">取得状況へ戻る</Link></header>
    <aside className={styles.warning}><strong>配信前の運営画面</strong><span>原文・数値・解釈を人間が確認するための画面です。承認操作だけで会員へ配信されることはありません。</span></aside>
    <section className={styles.auth} aria-label="編集者認証"><label>編集用トークン<input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} /></label><div className={styles.authActions}><button disabled={busy || token.length < 24} onClick={() => load()}>速報原文を読み込む</button><div className={styles.tickerLoad}><input aria-label="年次報告書のティッカー" value={annualTicker} maxLength={15} onChange={event => setAnnualTicker(event.target.value.toUpperCase())} /><button disabled={busy || token.length < 24} onClick={() => loadAnnual()}>年次報告書を開く</button></div></div><p aria-live="polite">{message}</p></section>
    {(items.length > 0 || annualSource) && <div className={styles.modeTabs} role="tablist" aria-label="レビュー対象"><button role="tab" aria-selected={mode === "news"} disabled={!items.length} onClick={() => setMode("news")}>速報レビュー</button><button role="tab" aria-selected={mode === "annual"} disabled={!annualSource} onClick={() => setMode("annual")}>年次報告書レビュー</button></div>}
    {mode === "news" && items.length > 0 && <div className={styles.workspace}>
      <nav aria-label="確認する原文"><h2>確認待ち原文</h2>{items.map(item => <button key={item.url} aria-current={selected?.url === item.url} onClick={() => setSelectedUrl(item.url)}><b>{item.ticker}</b><span>{item.title || new URL(item.url).pathname.split("/").filter(Boolean).at(-1)}</span><small>{labels[item.brief_status ?? ""] ?? "下書きなし"}</small></button>)}</nav>
      {selected && <article className={styles.editor}>
        <div className={styles.sourceHead}><div><p>{selected.ticker} · SHA {selected.sha256.slice(0, 12)}…</p><h2>{selected.title || "公式原文"}</h2></div><a href={selected.url} target="_blank" rel="noopener noreferrer">公式原文 ↗</a></div>
        <details open className={styles.evidence}><summary>取得した原文証拠（{selected.source_text.length.toLocaleString("ja-JP")}文字）</summary><pre>{selected.source_text}</pre>{selected.source_text_truncated && <p>画面表示は80,000文字で打ち切っています。承認前に公式原文も確認してください。</p>}</details>
        <section className={styles.form}><div><h2>AIによる根拠付き下書き</h2><p>設定済みの場合だけ1件生成します。現在の原文・完全一致する根拠抜粋・数値照合を通過しない限り保存されません。</p>{selected.generation_job_status && <small>自動処理：{jobLabels[selected.generation_job_status] ?? selected.generation_job_status} · 試行 {selected.generation_job_attempts ?? 0}回{selected.generation_job_error ? ` · ${selected.generation_job_error}` : ""}</small>}{selected.generation_model && <small>生成記録：{selected.generation_provider} · {selected.generation_model}{selected.generation_total_tokens != null ? ` · ${selected.generation_total_tokens.toLocaleString("ja-JP")} tokens` : " · 使用量未取得"}{selected.generation_source_truncated ? " · 入力上限のため原文を短縮" : ""}</small>}</div><button type="button" disabled={busy} onClick={generateDraft}>AI下書きを生成</button></section>
        <form key={`${selected.url}-draft-${selected.generated_at}`} onSubmit={submitDraft} className={styles.form}><h2>日本語速報の下書き</h2>
          <label>事実要約<textarea name="summaryJa" minLength={20} maxLength={600} required defaultValue={selected.summary_ja ?? ""} /></label>
          <label>要約の根拠抜粋<textarea name="summaryEvidence" required defaultValue={selected.evidence.summary.join("\n\n")} /><small>原文に完全一致する抜粋。複数は空行で区切ります。</small></label>
          <div className={styles.row}><label>影響分類<select name="impactLabel" defaultValue={selected.impact_label ?? "uncertain"}><option value="positive">positive</option><option value="negative">negative</option><option value="mixed">mixed</option><option value="neutral">neutral</option><option value="uncertain">uncertain</option></select></label><label>確信度<select name="confidence" defaultValue={selected.confidence ?? "low"}><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label></div>
          <label>影響と未確認事項<textarea name="impactJa" minLength={20} maxLength={900} required defaultValue={selected.impact_ja ?? ""} /></label>
          <label>影響判定の根拠抜粋<textarea name="impactEvidence" required defaultValue={selected.evidence.impact.join("\n\n")} /></label>
          <button disabled={busy}>根拠付き下書きを保存</button>
        </form>
        <form onSubmit={submitReview} className={styles.form}><h2>人間による最終判断</h2><p>現在：{labels[selected.brief_status ?? ""] ?? "下書きなし"}</p>
          <div className={styles.row}><label>判断<select name="decision"><option value="held">保留</option><option value="approved">承認</option><option value="rejected">却下</option></select></label><label>確認者<input name="reviewer" required minLength={2} /></label></div>
          <label>判断理由<textarea name="reason" required minLength={5} /></label><button disabled={busy || !selected.brief_status}>判断を記録</button>
        </form>
      </article>}
    </div>}
    {mode === "annual" && annualSource?.business && annualSource.risks && <article className={`${styles.editor} ${styles.annualEditor}`}>
      <div className={styles.sourceHead}><div><p>{annualSource.business.ticker} · {annualSource.business.form} · SHA {annualSource.business.sourceSha256.slice(0, 12)}…</p><h2>年次報告書の日本語要点</h2></div><a href={annualSource.business.documentUrl} target="_blank" rel="noopener noreferrer">SEC原文 ↗</a></div>
      <div className={styles.annualMeta}><span>提出日 {annualSource.business.filingDate}</span><span>対象期末 {annualSource.business.reportDate ?? "未記載"}</span><span>提出番号 {annualSource.business.accessionNumber}</span><span>現在：{labels[annualRecord?.status ?? ""] ?? "下書きなし"}</span></div>
      <div className={styles.annualEvidenceGrid}>
        <details open className={styles.evidence}><summary>事業説明のSEC原文（{annualSource.business.excerpt.length.toLocaleString("ja-JP")}文字）</summary><pre>{annualSource.business.excerpt}</pre></details>
        <details open className={styles.evidence}><summary>リスク項目のSEC原文（{annualSource.risks.excerpt.length.toLocaleString("ja-JP")}文字）</summary><pre>{annualSource.risks.excerpt}</pre></details>
      </div>
      <form key={`${annualSource.business.accessionNumber}-${annualRecord?.generatedAt ?? "new"}`} onSubmit={submitAnnualDraft} className={styles.form}><h2>根拠付き日本語要点の下書き</h2><p>英語原文から完全一致する引用を選びます。ここではAI生成を行わず、人間が作成した下書きとして保存します。</p>
        <label>企業の要点<textarea name="summaryJa" minLength={20} maxLength={500} required defaultValue={annualRecord?.summaryJa ?? ""} /></label>
        <label>何で稼ぐ会社か<textarea name="businessModelJa" minLength={20} maxLength={800} required defaultValue={annualRecord?.businessModelJa ?? ""} /></label>
        <label>事業説明の根拠引用<textarea name="businessEvidence" minLength={24} maxLength={800} required defaultValue={annualBusinessEvidence} /><small>上の事業説明に完全一致する24〜800文字。要点とビジネスモデルの両方を支える引用を選びます。</small></label>
        <label>重要リスク<textarea name="riskPointJa" minLength={12} maxLength={360} required defaultValue={annualRecord?.riskPointsJa[0]?.text ?? ""} /></label>
        <label>リスクの根拠引用<textarea name="riskEvidence" minLength={24} maxLength={800} required defaultValue={annualRiskEvidence} /><small>上のリスク原文に完全一致する24〜800文字。原文にない数値を日本語へ追加すると保存を拒否します。</small></label>
        <label>確信度<select name="confidence" defaultValue={annualRecord?.confidence ?? "low"}><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label>
        <button disabled={busy}>年次報告書の下書きを保存</button>
      </form>
      <form onSubmit={submitAnnualReview} className={styles.form}><h2>人間による最終判断</h2><p>SEC原文・提出番号・SHA・根拠引用・数値を確認してから判断します。原文更新時は公開側で自動失効します。</p>
        <div className={styles.row}><label>判断<select name="decision"><option value="held">保留</option><option value="approved">承認</option><option value="rejected">却下</option></select></label><label>確認者<input name="reviewer" required minLength={2} /></label></div>
        <label>判断理由<textarea name="reason" required minLength={5} maxLength={500} /></label><button disabled={busy || !annualRecord}>判断を記録</button>
      </form>
    </article>}
  </main>;
}
