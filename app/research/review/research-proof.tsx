"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./news-panel.module.css";

type Text = { text: string | null; chars: number | null; truncated: boolean };
type Evidence = Text & { literalCurrentResearchBody: boolean };
type Copy = { status: string; payloadSha256: string | null; complete: boolean; omittedFacts: number;
  fields: { field: string; ja: Text; en: Text; savedEvidenceQuote: Evidence;
    currentEvidenceId: string | null; resolvedCurrentEvidence: Evidence | null }[] };
type StoredClocks = { startedAt: Text; publicAt: Text; generationMs: number | null };
type Proof = {
  eventId: number; status: string; currentRevision: boolean; sourceSha: string; bodySha: string;
  sourceId: string; url: string; title: Text; generatedAt: string;
  sourceClock: { value: string | null; precision: string }; storedObservedAt: Text;
  researchBody: { storageKind: string; revisionSha: string; bodyTextSha256: string; text: string;
    chars: number; returnedChars: number; truncated: boolean; storedBodyAt: Text;
    recordedAcquisitionProof?: { sourceUrl: string; sourceTitle: Text; storedPublishedOn: Text;
      storedFetchedAt: Text; extractorVersion: Text; rawContentSha: string | null } | null } | null;
  acquisition?: { kind: string; present: boolean; revisionSha?: string; bodyTextSha256?: string | null;
    storedBodySha?: string | null; chars?: number | null; matchesResearchBody?: boolean | null };
  job?: { state: string; attempts: number; currentSourceRevision: boolean } | null;
  publication: { present: boolean; currentRevision: boolean; sourceSha?: string; bodySha?: string;
    storedClocks?: StoredClocks; copy: Copy | null; validation?: { status: string };
    selectedEvidence?: { status: string; items: Evidence[]; omitted: number | null } | null;
    derivation?: { kind: string; version: number; storedDerivedAt: Text; currentAuditValidated: boolean } | null } | null;
  latestFailure: { status: string; reason?: string | null; storedFailedAt?: Text; copy: Copy | null;
    sourceSha?: string; bodySha?: string; validation?: { status: string } } | null;
  omittedResearchBodyChars?: number | null;
};
type Selection = { token: string | null; eventId: number; sourceSha: string; bodySha: string };
const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const rawTime = (value?: Text) => value?.text ? `${value.text}${value.truncated ? "（省略あり）" : ""}` : "未記録";

function StoredText({ value }: { value: Text }) {
  return <><pre className={styles.source}>{value.text ?? "未記録"}</pre>
    {value.truncated && <p className={styles.note}>元は{value.chars}文字。表示上限により省略があります。</p>}</>;
}
function EvidenceText({ value }: { value: Evidence }) {
  return <><p>現在の研究本文への完全一致: {value.literalCurrentResearchBody ? "あり" : "なし・未確認"}</p><StoredText value={value} /></>;
}
function SavedCopy({ value }: { value: Copy | null }) {
  if (!value) return <p>同じ版として安全に開示できる記録はありません。</p>;
  return <><p>コピー状態: {value.status} · 既知フィールドの省略 {value.complete ? "なし" : "あり・確認不能"} · 省略した事実 {value.omittedFacts}件</p>
    <pre className={styles.source}>保存ペイロード SHA-256: {value.payloadSha256 ?? "未記録"}</pre>
    {value.fields.map(field => <section key={field.field}>
      <h5>{field.field}</h5><p>保存された日本語</p><StoredText value={field.ja} />
      <p>保存された英語</p><StoredText value={field.en} />
      <p>保存された選択引用</p><EvidenceText value={field.savedEvidenceQuote} />
      {field.resolvedCurrentEvidence && <><p>現在の根拠IDに対応する引用: {field.currentEvidenceId}</p><EvidenceText value={field.resolvedCurrentEvidence} /></>}
    </section>)}</>;
}

export function ResearchProofResult({ data }: { data: Proof }) {
  if (data.status !== "current" || !data.currentRevision || !data.researchBody || data.researchBody.revisionSha !== data.bodySha) {
    return <p role="status">選択した原文版を確認できません（{data.status}）。診断一覧を再取得してください。本文・保存文章は表示しません。{data.omittedResearchBodyChars ? `本文${data.omittedResearchBodyChars}文字は未表示です。` : ""}</p>;
  }
  const body = data.researchBody;
  const publication = data.publication;
  const publicationCurrent = publication?.currentRevision && publication.sourceSha === data.sourceSha && publication.bodySha === data.bodySha;
  const failureCurrent = data.latestFailure?.status === "current-attempt-body-proven" && data.latestFailure.sourceSha === data.sourceSha && data.latestFailure.bodySha === data.bodySha;
  return <details open><summary>選択した1件の研究本文・保存文章・根拠（非公開）</summary>
    <p className={styles.note}>読取専用です。公開・修正・再試行・外部への再取得は行いません。これは取得時点の保存記録で、初回公開・初回検証・ブラウザー表示の証明ではありません。</p>
    <p>イベント {data.eventId} · {data.sourceId} · {data.title.text}</p>
    <p>発信元URL: {data.url}</p>
    <p className={styles.note}>確認 {data.generatedAt} · 原文の公表 {data.sourceClock.value ?? "未記録"}（{data.sourceClock.precision}） · 保存された検知時刻 {rawTime(data.storedObservedAt)}</p>
    <pre className={styles.source}>{`Event/source SHA: ${data.sourceSha}\nResearch revision SHA: ${body.revisionSha}\nResearch text SHA-256: ${body.bodyTextSha256}`}</pre>
    <h4>取得元文書と研究本文は別の記録です</h4>
    <p>取得元文書 {data.acquisition?.chars ?? "未記録"}文字 · 研究本文と同一 {data.acquisition?.matchesResearchBody === true ? "はい" : data.acquisition?.matchesResearchBody === false ? "いいえ" : "未確認"}</p>
    <pre className={styles.source}>{`Acquisition revision SHA: ${data.acquisition?.revisionSha ?? "未記録"}\nAcquisition text SHA-256: ${data.acquisition?.bodyTextSha256 ?? "未記録"}`}</pre>
    <p className={styles.note}>取得元の短い要約・RSS文書は、下の研究本文や生成時の本文の代わりにはなりません。研究本文の取得時刻は現在保存されている取得記録で、初回取得とは限りません。</p>
    <h4>現在の研究本文</h4><p>{body.storageKind} · {body.returnedChars}/{body.chars}文字 · 省略 {body.truncated ? "あり" : "なし"} · 保存取得時刻 {rawTime(body.storedBodyAt)}</p>
    <pre className={styles.source}>{body.text}</pre>
    {body.recordedAcquisitionProof ? <details><summary>同じ本文版の保存取得証明</summary>
      <p>{body.recordedAcquisitionProof.sourceUrl} · {body.recordedAcquisitionProof.sourceTitle.text}</p>
      <p>保存公表日 {rawTime(body.recordedAcquisitionProof.storedPublishedOn)} · 保存取得時刻 {rawTime(body.recordedAcquisitionProof.storedFetchedAt)} · 抽出器 {rawTime(body.recordedAcquisitionProof.extractorVersion)}</p>
      <pre className={styles.source}>取得した元データのSHA-256: {body.recordedAcquisitionProof.rawContentSha ?? "未記録"}</pre>
    </details> : <p className={styles.note}>同じ本文版の追加の取得証明は未確認です。本文の完全性と過去の生成時本文の証明は別です。</p>}
    <h4>保存公開記事の文章</h4>
    <p>{!publication?.present ? "保存公開記事なし" : publicationCurrent ? "同じ原文・本文版" : "保存記事は別の版。文章は非表示です。"} · 現在の再検証 {publication?.validation?.status ?? "未確認"}</p>
    {publication?.present && <pre className={styles.source}>{`Stored publication source SHA: ${publication.sourceSha ?? "未記録"}\nStored publication body SHA: ${publication.bodySha ?? "未記録"}`}</pre>}
    {publication?.storedClocks && <p className={styles.note}>保存レコードの生の時刻（正当性・初回公開を保証しません）: 開始 {rawTime(publication.storedClocks.startedAt)} · 公開 {rawTime(publication.storedClocks.publicAt)} · 処理時間 {publication.storedClocks.generationMs ?? "未記録"} ms</p>}
    {publication?.derivation && <p className={styles.note}>導出 {publication.derivation.kind} v{publication.derivation.version} · 保存導出時刻 {rawTime(publication.derivation.storedDerivedAt)} · 現在の監査照合 {publication.derivation.currentAuditValidated ? "通過" : "未通過"}</p>}
    <SavedCopy value={publicationCurrent ? publication?.copy ?? null : null} />
    {publicationCurrent && publication?.selectedEvidence && <details><summary>保存公開記事の選択根拠一覧（省略 {publication.selectedEvidence.omitted ?? "不明"}件）</summary>
      {publication.selectedEvidence.items.map((quote, index) => <EvidenceText key={index} value={quote} />)}
    </details>}
    <h4>直近の失敗した文章（保存公開記事とは別）</h4>
    <p>開示状態 {data.latestFailure?.status ?? "unavailable"} · 当時の失敗理由 {data.latestFailure?.reason ?? "未記録"} · 保存失敗時刻 {rawTime(data.latestFailure?.storedFailedAt)}</p>
    <p className={styles.note}>現在のジョブ・直近の試行・生成時本文の記録が同じ版に一致する場合だけ表示します。当時の失敗理由と、現在の再検証結果 {data.latestFailure?.validation?.status ?? "未確認"} は別です。</p>
    <SavedCopy value={failureCurrent ? data.latestFailure?.copy ?? null : null} />
    <p className={styles.note}>ジョブ {data.job?.state ?? "未記録"} · 試行 {data.job?.attempts ?? "未記録"}回。文章は正規化・編集せず保存値を表示し、任意のモデルメタデータは含めません。</p>
  </details>;
}

export function ResearchProofInspection(props: Selection) {
  return <ResearchProofSession key={`${props.token}:${props.eventId}:${props.sourceSha}:${props.bodySha}`} {...props} />;
}
function ResearchProofSession({ token, eventId, sourceSha, bodySha }: Selection) {
  const [data, setData] = useState<Proof | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);
  const valid = Number.isSafeInteger(eventId) && eventId > 0 && eventId <= 999_999_999_999 && hash(sourceSha) && hash(bodySha);
  async function inspect() {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setData(null); setError("");
    try {
      const query = new URLSearchParams({ kind: "official-research", eventId: String(eventId), expectedSourceSha: sourceSha, expectedBodySha: bodySha });
      const response = await fetch(`/api/research/${token === null ? "editor-owner" : "editor"}?${query}`, {
        cache: "no-store", credentials: "same-origin", headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }) },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      });
      const payload = await response.json();
      if (token === null && (response.status === 401 || response.status === 403)) window.dispatchEvent(new Event("tech-phase:membership-changed"));
      if (!response.ok || !payload.ok || payload.detail?.eventId !== eventId) throw Error("unavailable");
      if (payload.detail.status === "current" && (payload.detail.sourceSha !== sourceSha || payload.detail.bodySha !== bodySha)) throw Error("mismatched-revision");
      if (active.current === controller && !controller.signal.aborted) setData(payload.detail);
    } catch {
      if (active.current === controller && !controller.signal.aborted) setError("同じ版の研究本文・保存文章を取得できませんでした。診断一覧とログイン状態を確認してください。");
    } finally {
      if (active.current === controller && !controller.signal.aborted) setBusy(false);
    }
  }
  return <div>
    <button type="button" disabled={!valid || busy || (token !== null && token.length < 24)} onClick={() => void inspect()}>{busy ? "研究記録を取得中…" : "この1件の研究本文・保存文章・根拠を確認（編集者用）"}</button>
    {error && <p role="alert">{error}</p>}
    {data && <ResearchProofResult data={data} />}
  </div>;
}
