"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./review.module.css";

type Evidence = { summary: string[]; impact: string[] };
type ReviewItem = {
  url: string; ticker: string; title: string | null; published_on: string | null; discovered_at: string;
  checked_at: string; sha256: string; source_text: string; source_text_truncated: boolean;
  summary_ja: string | null; impact_label: string | null; impact_ja: string | null; confidence: string | null;
  brief_status: string | null; generated_at: string | null; reviewed_at: string | null; evidence: Evidence;
};

const labels: Record<string, string> = { draft: "下書き", approved: "承認済み", held: "保留", rejected: "却下", stale: "原文変更・再確認" };
const splitEvidence = (value: string) => value.split(/\n{2,}/).map(v => v.trim()).filter(Boolean);

export default function ReviewDashboard() {
  const [token, setToken] = useState("");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [selectedUrl, setSelectedUrl] = useState("");
  const [message, setMessage] = useState("編集用トークンを入力してください。ブラウザーには保存しません。");
  const [busy, setBusy] = useState(false);
  const selected = useMemo(() => items.find(item => item.url === selectedUrl) ?? items[0], [items, selectedUrl]);

  async function request(method: "GET" | "POST", body?: unknown) {
    const result = await fetch("/api/research/editor?limit=30", {
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
      setMessage(successMessage ?? `確認可能な原文 ${payload.items.length}件を読み込みました。`);
    } catch (error) {
      setMessage(`読み込み失敗：${error instanceof Error ? error.message : "unknown"}`);
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

  return <main className={styles.main}>
    <header><div><p>TECH PHASE · PRIVATE EDITOR</p><h1>根拠付き速報レビュー</h1></div><Link href="/research/intake">取得状況へ戻る</Link></header>
    <aside className={styles.warning}><strong>配信前の運営画面</strong><span>原文・数値・解釈を人間が確認するための画面です。承認操作だけで会員へ配信されることはありません。</span></aside>
    <section className={styles.auth} aria-label="編集者認証"><label>編集用トークン<input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} /></label><button disabled={busy || token.length < 24} onClick={() => load()}>原文を読み込む</button><p aria-live="polite">{message}</p></section>
    {items.length > 0 && <div className={styles.workspace}>
      <nav aria-label="確認する原文"><h2>確認待ち原文</h2>{items.map(item => <button key={item.url} aria-current={selected?.url === item.url} onClick={() => setSelectedUrl(item.url)}><b>{item.ticker}</b><span>{item.title || new URL(item.url).pathname.split("/").filter(Boolean).at(-1)}</span><small>{labels[item.brief_status ?? ""] ?? "下書きなし"}</small></button>)}</nav>
      {selected && <article className={styles.editor}>
        <div className={styles.sourceHead}><div><p>{selected.ticker} · SHA {selected.sha256.slice(0, 12)}…</p><h2>{selected.title || "公式原文"}</h2></div><a href={selected.url} target="_blank" rel="noopener noreferrer">公式原文 ↗</a></div>
        <details open className={styles.evidence}><summary>取得した原文証拠（{selected.source_text.length.toLocaleString("ja-JP")}文字）</summary><pre>{selected.source_text}</pre>{selected.source_text_truncated && <p>画面表示は80,000文字で打ち切っています。承認前に公式原文も確認してください。</p>}</details>
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
  </main>;
}
