"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./news-panel.module.css";

type Clock = { value: string | null; omitted: boolean };
type Proof = {
  sourceId: string; url: string; expectedSourceSha: string; sourceSha: string;
  currentOriginSha: string | null; sourceKind: string; status: string; currentRevision: boolean;
  text: string | null; title: string | null; bodySha256: string | null; bodyChars: number | null;
  bodyBytes: number | null; returnedBodyChars: number; omittedBodyChars: number | null;
  textIncluded: boolean; researchBodyIncluded: boolean; sourceTruncated: boolean | null;
  selectedForProcessing: boolean | null; generatedAt: string;
  publishedAt?: Clock; firstSeenAt?: Clock; lastSeenAt?: Clock;
};
type Selection = { token: string | null; sourceId: string; url: string; sourceSha: string };
const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const clock = (value?: Clock) => value?.value ? `${value.value}${value.omitted ? "（省略あり）" : ""}` : "未記録";

export function RetainedSourceProofResult({ data }: { data: Proof }) {
  const current = data.status === "current" && data.currentRevision && data.textIncluded
    && data.sourceKind === "retained-x-acquisition" && !data.researchBodyIncluded
    && hash(data.expectedSourceSha) && data.sourceSha === data.expectedSourceSha
    && data.currentOriginSha === data.expectedSourceSha && data.bodySha256 && hash(data.bodySha256);
  if (!current) return <p role="status">選択した保存投稿版を確認できません（{data.status}）。一覧を再取得してください。保存本文は表示しません。未表示 {data.omittedBodyChars ?? "不明"}文字 / {data.bodyBytes ?? "不明"}バイト。</p>;
  return <section aria-label="選択した1件の保存取得本文（非公開）">
    <h5>選択した1件の保存取得本文（非公開）</h5>
    <p className={styles.note}>保存済みX取得行の読取専用です。イベント未作成でも確認できます。研究本文・生成時本文・保存記事とは別の記録です。表示中のX原文や翻訳への差し替えは行いません。</p>
    <p>{data.sourceId} · {data.title}</p><p>保存元URL: {data.url}</p>
    <p className={styles.note}>原投稿の保存公表時刻 {clock(data.publishedAt)} · この保存版の初回取得 {clock(data.firstSeenAt)} · 最終再観測 {clock(data.lastSeenAt)}</p>
    <p className={styles.note}>時刻は保存値です。初回取得と再観測は別で、研究本文の取得・生成・公開・画面配信の証明ではありません。確認 {data.generatedAt}</p>
    <pre className={styles.source}>{`Retained source SHA: ${data.sourceSha}\nCurrent origin SHA: ${data.currentOriginSha}\nStored body SHA-256: ${data.bodySha256}`}</pre>
    <p>取得時の処理選択フラグ: {data.selectedForProcessing ? "あり" : "なし"}（イベント・掲載の証明ではありません）</p>
    <p>保存本文 {data.returnedBodyChars}/{data.bodyChars}文字 · {data.bodyBytes}バイト · 開示省略 {data.omittedBodyChars}文字 · 取得時の切り詰め {data.sourceTruncated ? "あり" : "なし"}</p>
    <pre className={styles.source}>{data.text}</pre>
    <p className={styles.note}>Source SHAは保存された表題＋改行＋本文で照合し、Body SHAは保存本文だけから計算しています。取得時に省略された内容は復元しません。</p>
  </section>;
}

export function RetainedSourceProofInspection(props: Selection) {
  return <RetainedSourceProofSession key={`${props.token}:${props.sourceId}:${props.url}:${props.sourceSha}`} {...props} />;
}
function RetainedSourceProofSession({ token, sourceId, url, sourceSha }: Selection) {
  const [data, setData] = useState<Proof | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);
  const valid = /^[a-z][a-z0-9-]{0,79}$/.test(sourceId) && hash(sourceSha)
    && /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/[1-9][0-9]{0,19}$/.test(url);
  function close() {
    active.current?.abort(); active.current = null;
    setData(null); setError(""); setBusy(false);
  }
  async function inspect() {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setData(null); setError("");
    try {
      const query = new URLSearchParams({ kind: "official-research", retainedSourceId: sourceId, retainedUrl: url, expectedSourceSha: sourceSha });
      const response = await fetch(`/api/research/${token === null ? "editor-owner" : "editor"}?${query}`, {
        cache: "no-store", credentials: "same-origin", headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }) },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      });
      const payload = await response.json();
      if (active.current !== controller || controller.signal.aborted) return;
      if (token === null && (response.status === 401 || response.status === 403)) window.dispatchEvent(new Event("tech-phase:membership-changed"));
      if (!response.ok || !payload.ok || payload.detail?.sourceId !== sourceId || payload.detail?.url !== url
          || payload.detail?.expectedSourceSha !== sourceSha || payload.detail?.sourceSha !== sourceSha) throw Error("unavailable");
      if (payload.detail.status === "current" && payload.detail.currentOriginSha !== sourceSha) throw Error("mismatched-revision");
      setData(payload.detail);
    } catch {
      if (active.current === controller && !controller.signal.aborted) setError("同じ版の保存取得本文を確認できませんでした。一覧とログイン状態を確認してください。");
    } finally {
      if (active.current === controller && !controller.signal.aborted) setBusy(false);
    }
  }
  return <div>
    <button type="button" disabled={!valid || busy || (token !== null && token.length < 24)} onClick={() => void inspect()}>{busy ? "保存取得本文を確認中…" : "この保存投稿版の取得本文を確認（編集者用）"}</button>
    {(busy || data || error) && <button type="button" onClick={close}>閉じる・取得を中止</button>}
    {error && <p role="alert">{error}</p>}
    {data && <RetainedSourceProofResult data={data} />}
  </div>;
}
