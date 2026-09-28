"use client";

import { useState } from "react";
import styles from "./news-panel.module.css";

type Item = {
  id: string; revision: string; editVersion: string; title: string; url: string;
  publisher: string; text: string; tickers: string[]; publishedAt: string; observedAt: string;
  summaryJa: string | null; summaryEn: string | null; draftCurrent: boolean;
  generation?: { status: "not-attempted" | "reserved" | "failed" | "saved"; attempts: number; retryAllowed: boolean };
  review: { status: string; fingerprint: string | null; evidence: string[]; verification?: string[];
    impact: { impactJa: string; impactEn: string; impactLabel: ImpactLabel; confidence: Confidence } | null };
};
type ImpactLabel = "positive" | "negative" | "mixed" | "neutral" | "uncertain";
type Confidence = "high" | "medium" | "low";
type Queue = { items: Item[]; generationEnabled: boolean; publicationEnabled: boolean };
const labels: Record<string, string> = { pending: "下書き待ち", draft: "確認待ち", approved: "承認済み", held: "保留", rejected: "却下" };
const errors: Record<string, string> = {
  "unauthorized": "編集用トークンを確認してください。",
  "stale-news-edit": "別の編集または承認が行われました。最新データを読み直してください。",
  "stale-news-review": "下書きが更新されました。最新データを読み直してください。",
  "stale-news-draft": "原文が更新されました。最新データを読み直してください。",
  "invalid-news-language": "日英の要約をそれぞれ20〜1,200文字で入力してください。",
  "invalid-news-evidence": "原文と完全一致する根拠を1〜4件、各12〜800文字で入力してください。",
  "unsupported-news-number": "要約または影響説明の数値が根拠に含まれていません。数値と単位を確認してください。",
  "invalid-news-impact": "影響方向と確信度を選択してください。",
  "invalid-news-impact-confidence": "影響方向が不明の場合、確信度は低にしてください。",
  "invalid-news-impact-advice": "影響説明に株価予測、目標株価、売買推奨は記載できません。",
  "news-approval-verification-required": "承認には5項目すべての照合記録が必要です。最新データを読み直して再確認してください。",
  "news-generation-already-attempted": "この版は生成を試行済みです。保存結果を再取得し、必要なら手動で下書きを作成してください。",
  "news-generation-retry-confirmation-required": "再試行の明示確認がありません。最新データを読み直してください。",
  "news-generation-retry-unavailable": "この版は再試行できません。最新データを読み直してください。",
  "news-generation-retry-limit": "この版で許可された再試行は完了しています。手動で下書きを作成してください。",
  "news-draft-already-exists": "下書きがあります。最新データを読み直してください。",
  "news-generation-budget-exhausted": "本日の生成予算上限に達しています。",
  "generation-failed": "AI生成に失敗しました。最新データを読み直し、再試行可能なら明示ボタンを使用してください。",
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
  const [impactJa, setImpactJa] = useState(item.review.impact?.impactJa ?? "");
  const [impactEn, setImpactEn] = useState(item.review.impact?.impactEn ?? "");
  const [impactLabel, setImpactLabel] = useState<ImpactLabel>(item.review.impact?.impactLabel ?? "uncertain");
  const [confidence, setConfidence] = useState<Confidence>(item.review.impact?.confidence ?? "low");
  const [evidence, setEvidence] = useState(item.review.evidence.length ? item.review.evidence : [""]);
  const [reviewer, setReviewer] = useState("");
  const [reason, setReason] = useState("");
  const [verification, setVerification] = useState({ source: false, evidence: false, translations: false, "numbers-and-attribution": false, impact: false });
  const resetVerification = () => setVerification({ source: false, evidence: false, translations: false, "numbers-and-attribution": false, impact: false });
  const dirty = ja !== (item.summaryJa ?? "") || en !== (item.summaryEn ?? "")
    || impactJa !== (item.review.impact?.impactJa ?? "") || impactEn !== (item.review.impact?.impactEn ?? "")
    || impactLabel !== (item.review.impact?.impactLabel ?? "uncertain") || confidence !== (item.review.impact?.confidence ?? "low")
    || JSON.stringify(evidence.filter(Boolean)) !== JSON.stringify(item.review.evidence);
  const identity = { articleId: item.id, revision: item.revision };
  const canReview = !busy && !dirty && !!item.review.fingerprint && reviewer.trim().length >= 2 && reason.trim().length >= 5;
  const retry = item.generation?.retryAllowed === true && !item.draftCurrent;
  return <details className={styles.article}>
    <summary><span>{item.tickers.join(" · ")} · {labels[item.review.status] ?? "要確認"}</span><strong>{item.title}</strong></summary>
    <p className={styles.note}>{item.publisher} · 発表 {time(item.publishedAt)} · 取得 {time(item.observedAt)}</p>
    <a href={item.url} target="_blank" rel="noopener noreferrer">配信元の記事を確認 ↗</a>
    <details><summary>保存済みの原文（配信元から取得した範囲）</summary><pre className={styles.source}>{item.text}</pre></details>
    <fieldset disabled={busy} className={styles.fields}>
      <legend>日英下書き</legend>
      <div className={styles.languages}>
        <label>日本語<textarea lang="ja" value={ja} maxLength={1200} onChange={event => { setJa(event.target.value); resetVerification(); }} /></label>
        <label>English<textarea lang="en" value={en} maxLength={1200} onChange={event => { setEn(event.target.value); resetVerification(); }} /></label>
      </div>
      <div className={styles.classification}>
        <label>事業への影響方向<select value={impactLabel} onChange={event => { const value = event.target.value as ImpactLabel; setImpactLabel(value); if (value === "uncertain") setConfidence("low"); resetVerification(); }}>
          <option value="positive">プラス</option><option value="negative">マイナス</option><option value="mixed">両面</option><option value="neutral">中立</option><option value="uncertain">不明</option>
        </select></label>
        <label>確信度<select value={confidence} disabled={impactLabel === "uncertain"} onChange={event => { setConfidence(event.target.value as Confidence); resetVerification(); }}>
          <option value="high">高</option><option value="medium">中</option><option value="low">低</option>
        </select></label>
      </div>
      <div className={styles.languages}>
        <label>影響説明（日本語）<textarea lang="ja" value={impactJa} maxLength={1200} onChange={event => { setImpactJa(event.target.value); resetVerification(); }} /></label>
        <label>Impact rationale (English)<textarea lang="en" value={impactEn} maxLength={1200} onChange={event => { setImpactEn(event.target.value); resetVerification(); }} /></label>
      </div>
      <p className={styles.note}>影響は保存済み原文に直接書かれた事業上の含意だけを分類します。株価予測・目標株価・売買推奨は入力できません。方向を判断できない場合は「不明・低」を使用してください。</p>
      {evidence.map((excerpt, index) => <label key={index}>根拠 {index + 1}（原文からそのまま貼付）
        <textarea value={excerpt} maxLength={800} onChange={event => { setEvidence(evidence.map((text, i) => i === index ? event.target.value : text)); resetVerification(); }} />
      </label>)}
      <div className={styles.actions}>
        <button type="button" disabled={evidence.length >= 4} onClick={() => setEvidence([...evidence, ""])}>根拠欄を追加</button>
        <button type="button" disabled={ja.trim().length < 20 || en.trim().length < 20 || impactJa.trim().length < 20 || impactEn.trim().length < 20 || !evidence.some(text => text.length >= 12)} onClick={() => void run("news-draft", { ...identity, editVersion: item.editVersion, summaryJa: ja, summaryEn: en, impactJa, impactEn, impactLabel, confidence, evidence: evidence.filter(Boolean) })}>日英下書きと影響判定を保存</button>
        {!retry && <button type="button" disabled={!generationEnabled || item.draftCurrent || dirty || item.generation?.status !== "not-attempted"} onClick={() => void run("news-generate", identity)}>AIで日英下書きを生成</button>}
        {retry && <button type="button" disabled={!generationEnabled || dirty} onClick={() => void run("news-retry", { ...identity, editVersion: item.editVersion, confirmRetry: true })}>失敗したAI生成を1回だけ再試行</button>}
      </div>
      {!item.generation && <p className={styles.note}>生成履歴を確認できないため、AI生成操作を停止しています。</p>}
      {item.generation?.status === "reserved" && <p className={styles.note}>生成試行の完了確認待ちです。自動再実行は行いません。</p>}
      {item.generation?.status === "failed" && item.generation.attempts >= 2 && <p className={styles.note}>許可された生成試行は2回とも失敗しました。原文を確認して手動で下書きを保存してください。</p>}
    </fieldset>
    <fieldset disabled={busy} className={styles.fields}><legend>公開レビュー</legend>
      {item.review.status === "approved" && item.review.verification?.length === 5 && <p className={styles.note}>承認監査：原文・根拠・日英一致・数値／単位／期間／帰属・影響方向／確信度の5項目を保存済みです。</p>}
      <label>確認者<input value={reviewer} maxLength={120} autoComplete="off" onChange={event => setReviewer(event.target.value)} /></label>
      <label>判断理由<textarea value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
      <label className={styles.check}><input type="checkbox" checked={verification.source} onChange={event => setVerification({ ...verification, source: event.target.checked })} />公式リンクと保存済み原文の対象・更新状態を確認しました</label>
      <label className={styles.check}><input type="checkbox" checked={verification.evidence} onChange={event => setVerification({ ...verification, evidence: event.target.checked })} />各根拠が原文に存在し、要約の主要主張を支えることを確認しました</label>
      <label className={styles.check}><input type="checkbox" checked={verification.translations} onChange={event => setVerification({ ...verification, translations: event.target.checked })} />日本語と英語の意味・不確実性・重要な省略が一致することを確認しました</label>
      <label className={styles.check}><input type="checkbox" checked={verification["numbers-and-attribution"]} onChange={event => setVerification({ ...verification, "numbers-and-attribution": event.target.checked })} />数値・単位・期間・発言者への帰属を原文と照合しました</label>
      <label className={styles.check}><input type="checkbox" checked={verification.impact} onChange={event => setVerification({ ...verification, impact: event.target.checked })} />影響方向・確信度・日英の説明が根拠の範囲を超えていないことを確認しました</label>
      {dirty && <p className={styles.note}>未保存の編集があります。保存後の内容を確認してから承認してください。</p>}
      <div className={styles.actions}>{(["approved", "held", "rejected"] as const).map(decision => <button type="button" key={decision}
        disabled={!canReview || (decision === "approved" && !Object.values(verification).every(Boolean))} onClick={() => void run("news-review", { ...identity, fingerprint: item.review.fingerprint, decision, reviewer, reason, verification })}>{decision === "approved" ? "承認" : decision === "held" ? "保留" : "却下"}</button>)}</div>
    </fieldset>
  </details>;
}
