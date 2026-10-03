"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./news-panel.module.css";

type Validation = { status: "valid" | "invalid" | "unavailable"; issues: { field: string; issue: string; checks: Record<string, unknown>[] }[] };
type Item = {
  eventId: number; sourceId: string; url: string; title: string; ticker: string;
  currentSha: string; bodySha: string; observedAt: string; bodyReadyAt: string;
  publication: { present: boolean; currentRevision: boolean; validation: Validation };
  job: { state: string; attempts: number; nextRetryAt: string | null; currentRevision: boolean; failureKind: string | null } | null;
  latestFailure: { failedAt: string; reason: string | null; validation: Validation } | null;
};
type Queue = { items: Item[]; generatedAt: string; filteredTotal: number; counts: { candidates: number; validatedPublications: number; pending: number } };
const time = (value: string | null) => value ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false }) + " JST" : "未記録";
const states: Record<string, string> = { retry: "再試行待ち", running: "生成中", done: "処理済み", stale: "旧版", unknown: "状態不明" };
const verdicts: Record<Validation["status"], string> = { valid: "現在の機械検証を通過", invalid: "現在の機械検証で拒否", unavailable: "再検証用の記録なし" };

function Report({ report }: { report: Validation }) {
  return <div><p>{verdicts[report.status]}</p>{report.issues.map((issue, index) => <div key={`${issue.field}:${index}`}>
    <p>{issue.field} · {issue.issue}</p>
    {issue.checks.length > 0 && <pre className={styles.source}>{JSON.stringify(issue.checks, null, 2)}</pre>}
  </div>)}</div>;
}

export default function OfficialResearchPanel({ token }: { token: string }) {
  // A new in-memory credential starts a fresh session: no old data, errors,
  // busy state or requests can survive, even when the caller omits its own key.
  return <OfficialResearchSession key={token} token={token} />;
}

function OfficialResearchSession({ token }: { token: string }) {
  const [data, setData] = useState<Queue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);

  async function load() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/research/editor?kind=official-research&view=pending&limit=50", {
        cache: "no-store", headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error("unavailable");
      if (active.current === controller && !controller.signal.aborted) setData(result);
    } catch {
      if (active.current === controller && !controller.signal.aborted) setError("取得できませんでした。編集用トークンと監視サービスの接続を確認してください。");
    } finally {
      if (active.current === controller && !controller.signal.aborted) setBusy(false);
    }
  }

  return <section className={styles.panel} aria-labelledby="official-research-diagnostics-heading">
    <div className={styles.head}><div><p>公式本文の日英記事 · 編集者用</p><h2 id="official-research-diagnostics-heading">未公開記事の検証状況</h2></div>
      <button type="button" disabled={busy || token.length < 24} onClick={() => void load()}>{busy ? "読み込み中…" : "未公開記事の診断を読み込む"}</button></div>
    <p className={styles.note}>保存済み記録の読取専用です。生成・再試行・公開は実行しません。通常は文章や引用を返しません。期限内の承認済み2件に限り、修復監査と最新失敗・本文版の一致を確認し、未公開の日英文章と現在の本文に完全一致する選択済み根拠を文字数制限付きで表示します。</p>
    <p className={styles.note}>機械検証の拒否は誤情報の確定ではありません。数値の表記差や対応箇所を調べる手掛かりです。保存済みの失敗を現在の原文で再検証し、当時の本文版が記録されていない場合は当時の判定の完全再現とは区別します。</p>
    {error && <p role="alert">{error}{data ? " 下記は前回取得時の記録です。" : ""}</p>}
    {busy && <p role="status">保存済みの検証記録を取得中…</p>}
    {data && <>
      <p className={styles.note}>取得 {time(data.generatedAt)} · 現在の生成対象 {data.counts.candidates}件 · 有効な保存記事 {data.counts.validatedPublications}件 · 未公開 {data.counts.pending}件（{data.items.length}/{data.filteredTotal}件を表示）</p>
      <p className={styles.note}>生成処理と同じ対象範囲の診断です。公開一覧の表示件数上限による省略を、生成待ちには数えません。</p>
      <div className={styles.items}>{data.items.map(item => <article key={item.eventId} className={styles.article}>
        <h3>{item.ticker} · {item.title}</h3>
        <p className={styles.note}>イベント {item.eventId} · {item.sourceId}</p>
        <a href={item.url} target="_blank" rel="noopener noreferrer">発信元のページを確認 ↗</a>
        <p className={styles.note}>検知 {time(item.observedAt)} · 本文取得 {time(item.bodyReadyAt)}</p>
        <p>{item.job ? `${states[item.job.state] ?? "状態不明"} · ${item.job.attempts}回 · ${item.job.failureKind ?? "失敗区分なし"}${item.job.currentRevision ? "" : " · ジョブは旧版"}` : "現在の生成ジョブなし"}</p>
        {item.job && <p className={styles.note}>{item.job.state === "running" ? "実行期限" : "次の実行可能時刻"} {time(item.job.nextRetryAt)}（実行・公開の確約ではありません）</p>}
        <details><summary>現在の版と保存記事</summary>
          <pre className={styles.source}>{`Source SHA: ${item.currentSha}\nBody SHA: ${item.bodySha}`}</pre>
          <p>{item.publication.present ? item.publication.currentRevision ? "同じ版の保存記事あり" : "保存記事は旧版" : "保存記事なし"}</p>
          <Report report={item.publication.validation} />
        </details>
        {item.latestFailure ? <details open><summary>同じ原文版の直近失敗 · {item.latestFailure.reason ?? "区分なし"}</summary>
          <p className={styles.note}>記録 {time(item.latestFailure.failedAt)} · facts[0] は1件目の事実</p>
          <Report report={item.latestFailure.validation} />
        </details> : <p className={styles.note}>同じ原文版の失敗記録はありません。</p>}
      </article>)}</div>
      {data.items.length === 0 && <p>現在の生成対象に未公開記事はありません。</p>}
    </>}
  </section>;
}
