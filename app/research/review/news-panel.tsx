"use client";

import { useState } from "react";
import styles from "./news-panel.module.css";

type Item = {
  id: string; revision: string; editVersion: string; title: string; url: string;
  publisher: string; text: string; tickers: string[]; publishedAt: string; observedAt: string;
  summaryJa: string | null; summaryEn: string | null; draftCurrent: boolean;
  review: { status: string; fingerprint: string | null; evidence: string[] };
};
type Queue = { items: Item[]; generationEnabled: boolean; publicationEnabled: boolean };
const labels: Record<string, string> = { pending: "下書き待ち", draft: "確認待ち", approved: "承認済み", held: "保留", rejected: "却下" };
const errors: Record<string, string> = {
  "unauthorized": "編集用トークンを確認してください。",
  "stale-news-edit": "別の編集または承認が行われました。最新データを読み直してください。",
  "stale-news-review": "下書きが更新されました。最新データを読み直してください。",
  "stale-news-draft": "原文が更新されました。最新データを読み直してください。",
  "invalid-news-language": "日英の要約をそれぞれ20〜1,200文字で入力してください。",
  "invalid-news-evidence": "原文と完全一致する根拠を1〜4件、各12〜800文字で入力してください。",
  "unsupported-news-number": "要約中の数値が根拠に含まれていません。数値と単位を確認してください。",
  "news-generation-already-attempted": "この版は生成を試行済みです。保存結果を再取得し、必要なら手動で下書きを作成してください。",
  "news-draft-already-exists": "下書きがあります。最新データを読み直してください。",
  "news-generation-budget-exhausted": "本日の生成予算上限に達しています。",
  "generation-not-configured": "AI生成は無効、または設定が未完了です。手動保存は利用できます。",
};
const time = (value: string) => new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false }) + " JST";

export default function NewsPanel({ token }: { token: string }) {
  const [data, setData] = useState<Queue | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);

  async function request(query: string, body?: unknown) {
    const response = await fetch(`/api/research/editor${query}`, {
      method: body ? "POST" : "GET", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(body ? 118_000 : 20_000),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(errors[result.error] ?? "処理結果を確認できません。再実行する前に一覧を読み直してください。");
    return result;
  }
  async function load() {
    const result = await request("?kind=news&limit=50");
    setData(result); setVersion(value => value + 1);
  }
  async function run(action?: string, payload?: unknown) {
    setBusy(true); setMessage("");
    try {
      if (action) await request("", { action, payload });
      await load();
      setMessage(action ? "保存結果を読み込みました。" : "最新50件を読み込みました。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "取得できませんでした。"); }
    finally { setBusy(false); }
  }
  return <section className={styles.panel} aria-labelledby="ordinary-news-heading">
    <div className={styles.head}><div><p>通常ニュース</p><h2 id="ordinary-news-heading">日英下書き・公開レビュー</h2></div>
      <button type="button" disabled={busy || token.length < 24} onClick={() => void run()}>{busy ? "処理中…" : "通常ニュースを読み込む"}</button></div>
    <p className={styles.note}>原文に照らして両言語の意味・数値・単位を確認してください。編集後は再承認が必要です。一覧の再読込で未保存の入力は破棄されます。</p>
    <p role="status" aria-live="polite">{message}</p>
    {data && <><p className={styles.note}>AI生成：{data.generationEnabled ? "設定有効" : "OFF"} · 公開配信：{data.publicationEnabled ? "ON（承認後に表示）" : "OFF（承認しても非公開）"}</p>
      {!data.items.length && <p>取得済みの通常ニュースはありません。</p>}
      <div className={styles.items}>{data.items.map(item => <NewsEditor key={`${version}:${item.id}`} item={item} busy={busy} generationEnabled={data.generationEnabled} run={run} />)}</div>
    </>}
  </section>;
}

function NewsEditor({ item, busy, generationEnabled, run }: { item: Item; busy: boolean; generationEnabled: boolean; run: (action: string, payload: unknown) => Promise<void> }) {
  const [ja, setJa] = useState(item.summaryJa ?? "");
  const [en, setEn] = useState(item.summaryEn ?? "");
  const [evidence, setEvidence] = useState(item.review.evidence.length ? item.review.evidence : [""]);
  const [reviewer, setReviewer] = useState("");
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);
  const dirty = ja !== (item.summaryJa ?? "") || en !== (item.summaryEn ?? "") || JSON.stringify(evidence.filter(Boolean)) !== JSON.stringify(item.review.evidence);
  const identity = { articleId: item.id, revision: item.revision };
  const canReview = !busy && !dirty && !!item.review.fingerprint && reviewer.trim().length >= 2 && reason.trim().length >= 5;
  return <details className={styles.article}>
    <summary><span>{item.tickers.join(" · ")} · {labels[item.review.status] ?? "要確認"}</span><strong>{item.title}</strong></summary>
    <p className={styles.note}>{item.publisher} · 発表 {time(item.publishedAt)} · 取得 {time(item.observedAt)}</p>
    <a href={item.url} target="_blank" rel="noopener noreferrer">配信元の記事を確認 ↗</a>
    <details><summary>保存済みの原文（配信元から取得した範囲）</summary><pre className={styles.source}>{item.text}</pre></details>
    <fieldset disabled={busy} className={styles.fields}>
      <legend>日英下書き</legend>
      <div className={styles.languages}>
        <label>日本語<textarea lang="ja" value={ja} maxLength={1200} onChange={event => { setJa(event.target.value); setChecked(false); }} /></label>
        <label>English<textarea lang="en" value={en} maxLength={1200} onChange={event => { setEn(event.target.value); setChecked(false); }} /></label>
      </div>
      {evidence.map((excerpt, index) => <label key={index}>根拠 {index + 1}（原文からそのまま貼付）
        <textarea value={excerpt} maxLength={800} onChange={event => { setEvidence(evidence.map((text, i) => i === index ? event.target.value : text)); setChecked(false); }} />
      </label>)}
      <div className={styles.actions}>
        <button type="button" disabled={evidence.length >= 4} onClick={() => setEvidence([...evidence, ""])}>根拠欄を追加</button>
        <button type="button" disabled={ja.trim().length < 20 || en.trim().length < 20 || !evidence.some(text => text.length >= 12)} onClick={() => void run("news-draft", { ...identity, editVersion: item.editVersion, summaryJa: ja, summaryEn: en, evidence: evidence.filter(Boolean) })}>日英下書きを保存</button>
        <button type="button" disabled={!generationEnabled || item.draftCurrent || dirty} onClick={() => void run("news-generate", identity)}>AIで日英下書きを生成</button>
      </div>
    </fieldset>
    <fieldset disabled={busy} className={styles.fields}><legend>公開レビュー</legend>
      <label>確認者<input value={reviewer} maxLength={120} autoComplete="off" onChange={event => setReviewer(event.target.value)} /></label>
      <label>判断理由<textarea value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
      <label className={styles.check}><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />両言語を原文と照合し、意味・数値・単位・帰属を確認しました</label>
      {dirty && <p className={styles.note}>未保存の編集があります。保存後の内容を確認してから承認してください。</p>}
      <div className={styles.actions}>{(["approved", "held", "rejected"] as const).map(decision => <button type="button" key={decision}
        disabled={!canReview || (decision === "approved" && !checked)} onClick={() => void run("news-review", { ...identity, fingerprint: item.review.fingerprint, decision, reviewer, reason })}>{decision === "approved" ? "承認" : decision === "held" ? "保留" : "却下"}</button>)}</div>
    </fieldset>
  </details>;
}
