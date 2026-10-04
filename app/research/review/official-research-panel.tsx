"use client";

import { useEffect, useRef, useState } from "react";
import { SignalSourceInspection } from "./signals-panel";
import styles from "./news-panel.module.css";

type Validation = { status: "valid" | "invalid" | "unavailable"; issues: { field: string; issue: string; checks: Record<string, unknown>[] }[] };
type Item = {
  eventId: number; sourceId: string; url: string; title: string; ticker: string;
  currentSha: string; bodySha: string; observedAt: string; bodyReadyAt: string;
  publication: { present: boolean; currentRevision: boolean; validation: Validation };
  job: { state: string; attempts: number; nextRetryAt: string | null; currentRevision: boolean; failureKind: string | null } | null;
  latestFailure: { failedAt: string; reason: string | null; validation: Validation } | null;
};
type TerminalReview = Item & {
  status: "terminal-review";
  review: { reason: string; decidedAt: string };
  job: NonNullable<Item["job"]> & { state: "review"; nextRetryAt: null };
};
type TerminalReviews = { items: TerminalReview[]; total: number; omitted: number };
type IntakeRecord = {
  sourceId: string; url: string | null; sha: string; bodySha?: string | null;
  eventId: number | null; representativeEventId?: number | null;
  publishedAt: string | null; firstSeenAt: string | null; lastSeenAt: string | null;
  disposition: string; reason: string; currentRevision: boolean;
};
type IssuerRecord = {
  eventId: number; sourceId: string; url: string; title: string;
  sourceSha: string; bodySha: string | null; preparationReason: string;
  generationDisposition: string; generationEligibilityReason: string;
  companyRoleEvidence?: { issuer?: string; monitoredTicker?: string; role?: string | null } | null;
  nextPreparationAt?: number | null; nextGenerationAt?: number | null;
};
type Coverage = {
  currentQueryTracked: boolean; acquisitionState: string; generationStartedAt: string | null;
  coverageStartedAt: string | null; pagesSaved: number; postObservationsSaved: number;
  paginationPending: boolean; awaitingFirstPage?: boolean; initialWindowExpired?: boolean;
  retainedAcquisitionRows: number; rowsAboveRetentionTarget: number;
  knownOmittedAcquisitionRows: number; knownOmittedDocumentRows: number; knownOmittedEventRows: number;
};
type Pipeline = {
  configuredModel: string | null;
  retainedIntake: { counts: Record<string, number>; reasons: Record<string, number>; records?: IntakeRecord[];
    recordsTruncated?: boolean; responseOmittedRecords?: number };
  issuerPreparation: { total: number; counts: Record<string, number>; records: IssuerRecord[];
    recordsOmitted?: number; responseOmittedRecords?: number };
  acquisitionCoverage: Record<string, Coverage>;
};
type Queue = { items: Item[]; generatedAt: string; filteredTotal: number;
  counts: { candidates: number; validatedPublications: number; pending: number }; pipelineDiagnostics?: Pipeline;
  terminalReviews?: TerminalReviews };
const time = (value: string | null) => value ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false }) + " JST" : "未記録";
const states: Record<string, string> = { retry: "再試行待ち", running: "生成中", done: "処理済み", stale: "旧版", unknown: "状態不明" };
const verdicts: Record<Validation["status"], string> = { valid: "現在の機械検証を通過", invalid: "現在の機械検証で拒否", unavailable: "再検証用の記録なし" };

function Report({ report }: { report: Validation }) {
  return <div><p>{verdicts[report.status]}</p>{report.issues.map((issue, index) => <div key={`${issue.field}:${index}`}>
    <p>{issue.field} · {issue.issue}</p>
    {issue.checks.length > 0 && <pre className={styles.source}>{JSON.stringify(issue.checks, null, 2)}</pre>}
  </div>)}</div>;
}

const dispositions: Record<string, string> = {
  "review-required": "要確認", excluded: "対象外", selected: "記事候補へ選択済み",
  "awaiting-admission": "選択待ち", deduplicated: "重複統合",
  "published-target-route": "目標株価の掲載判定", "independent-route": "別処理経路",
};
const safeUrl = (value: string | null) => {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch { return null; }
};
const validEvent = (id: number | null | undefined): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0;

export function TerminalReviewOverview({ data, token }: { data?: TerminalReviews; token: string | null }) {
  if (!data) return null;
  const records = data.items.slice(0, 50);
  const omitted = Math.max(data.omitted + data.items.length - records.length, data.total - records.length, 0);
  return <section aria-label="要確認（自動再試行なし）">
    <h3>要確認（自動再試行なし）</h3>
    <p className={styles.note}>編集者用・読取専用です。意味検証で処理を停止した記録を表示します。自動生成対象の未公開件数には含みません。この表示は生成・再試行・公開を実行しません。</p>
    <p>要確認 {data.total}件（{records.length}/{data.total}件表示） · 省略 {omitted}件</p>
    {omitted > 0 && <p className={styles.note}>件数・応答容量の上限により一部省略されています。</p>}
    <div className={styles.items}>{records.map(item => {
      const url = safeUrl(item.url);
      return <article key={item.eventId} className={styles.article}>
        <h4>{item.ticker} · {item.title}</h4>
        <p className={styles.note}>イベント {item.eventId} · {item.sourceId}</p>
        <p>要確認の理由: {item.review.reason}</p>
        <p className={styles.note}>判定 {time(item.review.decidedAt)} · 検知 {time(item.observedAt)} · 本文取得 {time(item.bodyReadyAt)}</p>
        {url && <a href={url.href} target="_blank" rel="noopener noreferrer">発信元のページを確認 ↗</a>}
        {validEvent(item.eventId) && <SignalSourceInspection token={token} eventId={item.eventId} />}
        <details><summary>現在の原文版</summary>
          <pre className={styles.source}>{`Source SHA: ${item.currentSha}\nBody SHA: ${item.bodySha}`}</pre>
        </details>
        {item.latestFailure ? <details open><summary>同じ原文版の直近失敗 · {item.latestFailure.reason ?? "区分なし"}</summary>
          <p className={styles.note}>記録 {time(item.latestFailure.failedAt)} · facts[0] は1件目の事実</p>
          <Report report={item.latestFailure.validation} />
        </details> : <p className={styles.note}>同じ原文版の失敗記録はありません。</p>}
      </article>;
    })}</div>
    {data.total === 0 && records.length === 0 && <p>保存済みの要確認記録はありません。</p>}
  </section>;
}

export function NewsPipelineOverview({ data, token }: { data?: Pipeline; token: string | null }) {
  if (!data) return <p className={styles.note}>取得・分類の概要は未取得です。未公開0件だけでは網羅性を確認できません。</p>;
  const intake = data.retainedIntake;
  const count = (key: string) => intake.counts[key] ?? 0;
  const records = (intake.records ?? []).slice(0, 50);
  const issuers = data.issuerPreparation;
  const issuerRecords = issuers.records.slice(0, 50);
  return <section aria-label="取得・分類の概要">
    <h3>取得・分類の概要（編集者用・読取専用）</h3>
    <p className={styles.note}>自動生成の未公開件数と、保存投稿の要確認・対象外件数は別の集計です。未公開0件は全投稿の取得・掲載完了を意味しません。この表示は生成・再試行・公開を実行しません。</p>
    <p>設定済みモデル: {data.configuredModel ?? "識別子を確認できません"}</p>
    <h4>保存投稿の処理状況</h4>
    <p>保存版 {count("retainedRevisionRows")}行 · 現在の投稿 {count("currentOrigins")}件 · 要確認 {count("reviewRequiredRows")}行 · 対象外 {count("excludedRows")}行</p>
    <p>選択待ち {count("awaitingAdmissionRows")}行 · 意味確認待ち {count("assessmentPendingRows")}行 · 評価後の要確認 {count("assessedReviewRows")}行 · 検証済み記事に対応 {count("validatedPublicationRows")}行</p>
    <p className={styles.note}>保存済みの版だけが対象です。ブラウザーへの配信は未検証です。掲載判定と新着記事の配信所要時間は別です。</p>
    <details open><summary>投稿・版の記録（{records.length}/{count("retainedRevisionRows")}行表示）</summary>
      {(intake.recordsTruncated || count("retainedRevisionRows") > records.length || !!intake.responseOmittedRecords) && <p className={styles.note}>一覧は件数・応答容量の上限により一部省略されています。上の集計は表示分だけの件数ではありません。</p>}
      {records.map((record, index) => {
        const url = safeUrl(record.url);
        const postId = url?.hostname === "x.com" ? /^\/[^/]+\/status\/(\d+)$/.exec(url.pathname)?.[1] : null;
        const eventId = validEvent(record.eventId) ? record.eventId : validEvent(record.representativeEventId) ? record.representativeEventId : null;
        return <article key={`${record.sourceId}:${record.sha}:${index}`} className={styles.article}>
          <h4>{record.sourceId} · {dispositions[record.disposition] ?? record.disposition}</h4>
          <p>理由: {record.reason} · {record.currentRevision ? "現在の版" : "旧版"}</p>
          <p>投稿ID {postId ?? "未記録"} · イベント {record.eventId ?? "未作成"}{record.representativeEventId && record.representativeEventId !== record.eventId ? ` · 対応する代表イベント ${record.representativeEventId}` : ""}</p>
          <p className={styles.note}>投稿 {time(record.publishedAt)} · 初回取得 {time(record.firstSeenAt)} · 最終取得 {time(record.lastSeenAt)}</p>
          <pre className={styles.source}>{`Source SHA: ${record.sha}\nBody SHA: ${record.bodySha ?? "未記録"}`}</pre>
          {url && <a href={url.href} target="_blank" rel="noopener noreferrer">投稿元を確認 ↗</a>}
          {eventId !== null ? <SignalSourceInspection token={token} eventId={eventId} /> : <p className={styles.note}>イベント未作成のため、既存のイベント原文確認は利用できません。</p>}
        </article>;
      })}
      {records.length === 0 && <p>表示できる保存投稿の記録はありません。取得網羅性の確認とは異なります。</p>}
    </details>
    <details><summary>保存された取得範囲（経路別）</summary>
      <p className={styles.note}>取得ページの保存と記事の評価・掲載は別です。全投稿の網羅性は保証せず、計測開始前の欠落数は不明です。経路の有効・無効はこの表示では判定しません。</p>
      {Object.entries(data.acquisitionCoverage).map(([id, coverage]) => <article key={id} className={styles.article}>
        <h4>{id}</h4>
        <p>状態: {coverage.acquisitionState} · 現在の検索範囲の記録 {coverage.currentQueryTracked ? "あり" : "なし"}</p>
        <p className={styles.note}>記録開始 {time(coverage.generationStartedAt)} · 取得範囲の開始 {time(coverage.coverageStartedAt)}</p>
        <p>保存ページ {coverage.pagesSaved} · 投稿の保存観測 {coverage.postObservationsSaved} · 続きのページ {coverage.paginationPending ? "取得待ち" : "なし"}</p>
        {coverage.awaitingFirstPage && <p>初回ページ未取得です。</p>}
        {coverage.initialWindowExpired && <p>取得期間が期限切れのため未完了です。</p>}
        <p>保持 {coverage.retainedAcquisitionRows}行 · 保持目安超過 {coverage.rowsAboveRetentionTarget}行 · 計測済み省略: 投稿 {coverage.knownOmittedAcquisitionRows}行 / 文書 {coverage.knownOmittedDocumentRows}行 / イベント {coverage.knownOmittedEventRows}行</p>
      </article>)}
    </details>
    <details><summary>発表本文の準備状況（{issuerRecords.length}/{issuers.total}件表示）</summary>
      <p className={styles.note}>準備理由は生成・掲載の経路と重複します。追加の未公開件数として合算しません。</p>
      {(issuers.total > issuerRecords.length || !!issuers.recordsOmitted || !!issuers.responseOmittedRecords) && <p className={styles.note}>一覧は件数・応答容量の上限により一部省略されています。</p>}
      {issuerRecords.map(record => {
        const url = safeUrl(record.url);
        return <article key={record.eventId} className={styles.article}>
          <h4>{record.title}</h4>
          <p>イベント {record.eventId} · {record.sourceId}</p>
          <p>準備理由: {record.preparationReason} · 生成・掲載状態: {record.generationDisposition} · 適格性理由: {record.generationEligibilityReason}</p>
          {record.companyRoleEvidence && <p>発表主体 {record.companyRoleEvidence.issuer ?? "未確認"} · 対象 {record.companyRoleEvidence.monitoredTicker ?? "未確認"} · 役割 {record.companyRoleEvidence.role ?? "確認できない"}</p>}
          <pre className={styles.source}>{`Source SHA: ${record.sourceSha}\nBody SHA: ${record.bodySha ?? "未記録"}`}</pre>
          {url && <a href={url.href} target="_blank" rel="noopener noreferrer">発信元を確認 ↗</a>}
          {validEvent(record.eventId) && <SignalSourceInspection token={token} eventId={record.eventId} />}
        </article>;
      })}
    </details>
  </section>;
}

export default function OfficialResearchPanel({ token }: { token: string | null }) {
  // A new in-memory credential starts a fresh session: no old data, errors,
  // busy state or requests can survive, even when the caller omits its own key.
  return <OfficialResearchSession key={token} token={token} />;
}

function OfficialResearchSession({ token }: { token: string | null }) {
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
      const response = await fetch(`/api/research/${token === null ? "editor-owner" : "editor"}?kind=official-research&view=pending&limit=50`, {
        cache: "no-store", credentials: "same-origin", headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }) },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      });
      const result = await response.json();
      if (token === null && (response.status === 401 || response.status === 403)) window.dispatchEvent(new Event("tech-phase:membership-changed"));
      if (!response.ok || !result.ok) throw new Error("unavailable");
      if (active.current === controller && !controller.signal.aborted) setData(result);
    } catch {
      if (active.current === controller && !controller.signal.aborted) setError("取得できませんでした。ログイン状態と監視サービスの接続を確認してください。");
    } finally {
      if (active.current === controller && !controller.signal.aborted) setBusy(false);
    }
  }

  return <section className={styles.panel} aria-labelledby="official-research-diagnostics-heading">
    <div className={styles.head}><div><p>公式本文の日英記事 · 編集者用</p><h2 id="official-research-diagnostics-heading">取得状況と未公開記事の検証</h2></div>
      <button type="button" disabled={busy || (token !== null && token.length < 24)} onClick={() => void load()}>{busy ? "読み込み中…" : "取得・記事の診断を読み込む"}</button></div>
    <p className={styles.note}>保存済み記録の読取専用です。生成・再試行・公開は実行しません。失敗した日英文章を返す場合は、現在の本文に完全一致する選択済み根拠を表示上限付きで示し、生成時の本文版が確認できるかも区別します。</p>
    <p className={styles.note}>機械検証の拒否は誤情報の確定ではありません。数値の表記差や対応箇所を調べる手掛かりです。保存済みの失敗を現在の原文で再検証し、当時の本文版が記録されていない場合は当時の判定の完全再現とは区別します。</p>
    {error && <p role="alert">{error}{data ? " 下記は前回取得時の記録です。" : ""}</p>}
    {busy && <p role="status">保存済みの検証記録を取得中…</p>}
    {data && <OfficialResearchResults data={data} token={token} />}
  </section>;
}


export function OfficialResearchResults({ data, token }: { data: Queue; token: string | null }) {
  return <>
      <p className={styles.note}>取得 {time(data.generatedAt)} · 現在の生成対象 {data.counts.candidates}件 · 有効な保存記事 {data.counts.validatedPublications}件 · 未公開 {data.counts.pending}件（{data.items.length}/{data.filteredTotal}件を表示）</p>
      <p className={styles.note}>生成処理と同じ対象範囲の診断です。公開一覧の表示件数上限による省略を、生成待ちには数えません。</p>
      <NewsPipelineOverview data={data.pipelineDiagnostics} token={token} />
      <TerminalReviewOverview data={data.terminalReviews} token={token} />
      <h3>自動生成対象の未公開記事</h3>
      <div className={styles.items}>{data.items.map(item => <article key={item.eventId} className={styles.article}>
        <h3>{item.ticker} · {item.title}</h3>
        <p className={styles.note}>イベント {item.eventId} · {item.sourceId}</p>
        <a href={item.url} target="_blank" rel="noopener noreferrer">発信元のページを確認 ↗</a>
        <p className={styles.note}>検知 {time(item.observedAt)} · 本文取得 {time(item.bodyReadyAt)}</p>
        <SignalSourceInspection token={token} eventId={item.eventId} />
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
  </>;
}
