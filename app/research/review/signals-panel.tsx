"use client";

import { useEffect, useRef, useState } from "react";
import { targetPreview } from "@/lib/research/x-target-preview";
import styles from "./signals-panel.module.css";

type Signal = {
  id: number; source: string; sourceKind: string; reuse: string; url: string; title: string;
  tickers: string[]; eventKind: string; contentKind?: string | null; publishedAt: string | null; publishedOn?: string | null; observedAt: string;
  excerpt: string; diff: string; truncated: boolean;
};
type Route = {
  id: string; name: string; kind: string; intervalSeconds: number; checkedAt: string | null;
  succeededAt: string | null; nextCheckAt: string | null; error: string | null; matchedItems: number; pendingArticles: number;
  articleErrors?: { url: string; error: string; nextCheckAt: string | null; checkedAt: string | null }[];
};
type TargetReconciliation = {
  windowDays: 7; windowBasis: "publishedAt"; generatedAt: string;
  counts: { candidateRevisionRows: number; uniqueSourcePosts: number; publishedPosts: number;
    unpublishedPosts: number; rejectedPosts: number; supersededRevisionRows: number;
    eligibleActions: number; returnedActions: number; actionsOutsideFeedLimit: number };
  reasons: Record<string, number>;
  records: { sourceId: string; url: string | null; eventId: number | null; sha: string | null;
    publishedAt: string | null; observedAt: string | null; disposition: "published" | "unpublished" | "rejected";
    reason: string; currentRevision: boolean }[];
  recordLimit: 50; recordsTruncated: boolean;
  coverage: { retainedOnly: true; rowsPerSourceLimit: 1000; browserDeliveryVerified: false; feedLimit: 20 };
};
type SignalDetail = {
  eventId: number; sourceId: string; sourceName: string; sourceKind: string; url: string | null;
  title: string; tickers: string[]; eventSha256: string | null; publishedAt: string | null;
  publishedOn: string | null; observedAt: string | null; currentRevision: boolean;
  status: "current" | "stale" | "missing-document" | "body-limit" | "integrity-mismatch";
  documentSha256: string | null; bodySha256: string | null; bodyChars: number | null;
  bodyAt: string | null; firstSeenAt: string | null; lastSeenAt: string | null;
  sourceTruncated: boolean; text: string | null;
};
type Queue = {
  ok: boolean; error?: string; items: Signal[]; routes: Route[]; tickers: string[];
  counts: Record<string, number>; enabled: boolean; workerAlive: boolean; generatedAt: string;
  xApiUsage?: { requested: boolean; configured: boolean; enabled: boolean; attemptsLast24Hours: number;
    dailyLimit: number; limitReached: boolean; nextAvailableAt: string | null; sourceCount: number;
    scope: string; configuredMaxRequestsPerDay: number; localMaxRequestsPerDay: number; budgetCapped: boolean; pacingEnabled?: boolean;
    minimumSpacingSeconds?: number; minimumSourceSpacingSeconds?: number; pacedUntil?: string | null };
  priceTargetReconciliation?: TargetReconciliation;
};
const kindNames: Record<string, string> = {
  baseline: "初回取得・過去資料", new: "新規検出・発表時刻は要確認", changed: "内容変更",
};
const sourceNames: Record<string, string> = {
  "external-research": "外部調査", "publisher-update": "発信元の更新", "official-document": "公式ドキュメント",
};
const contentNames: Record<string, string> = {
  "analyst-rating": "アナリスト評価", "price-target": "目標株価", earnings: "決算投稿",
  "official-update": "企業公式", "publisher-update": "発信元投稿",
  "corporate-financing": "資金調達・転換社債",
};
const timeLabel = (value: string | null) => value ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false }) + " JST" : "未取得";
const publicationLabel = (publishedAt: string | null, publishedOn?: string | null) => {
  if (publishedAt) return timeLabel(publishedAt);
  const match = publishedOn?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}/${Number(match[2])}/${Number(match[3])}（時刻未公表）` : "未取得";
};
const durationLabel = (seconds: number) => `${Math.floor(seconds / 60)}分${seconds % 60 ? `${seconds % 60}秒` : ""}`;
const dispositionNames: Record<TargetReconciliation["records"][number]["disposition"], string> = {
  published: "フィード掲載判定", unpublished: "未公開", rejected: "解析で除外",
};
const safeSourceUrl = (value: string | null) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
};
const detailStatuses: Record<SignalDetail["status"], string> = {
  current: "保存原文と現在の版が一致", stale: "現在の保存原文は別の版", "missing-document": "保存原文なし",
  "body-limit": "原文の取得・表示上限", "integrity-mismatch": "原文の整合性が一致しません",
};

export function SignalSourceInspection({ token, eventId }: { token: string | null; eventId: number }) {
  return <SignalSourceInspectionSession key={`${token}:${eventId}`} token={token} eventId={eventId} />;
}

function SignalSourceInspectionSession({ token, eventId }: { token: string | null; eventId: number }) {
  const [detail, setDetail] = useState<SignalDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);
  async function inspect() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError(""); setDetail(null);
    try {
      const query = new URLSearchParams({ kind: "signals", eventId: String(eventId) });
      const response = await fetch(`/api/research/${token === null ? "editor-owner" : "editor"}?${query}`, {
        cache: "no-store", credentials: "same-origin", headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }) },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      });
      const payload: { ok: boolean; detail?: SignalDetail } = await response.json();
      if (token === null && (response.status === 401 || response.status === 403)) window.dispatchEvent(new Event("tech-phase:membership-changed"));
      if (!response.ok || !payload.ok || payload.detail?.eventId !== eventId) throw new Error("source-unavailable");
      if (active.current === controller && !controller.signal.aborted) setDetail(payload.detail);
    } catch {
      if (active.current === controller && !controller.signal.aborted) setError("保存原文を取得できませんでした。ログイン状態と接続を確認してください。");
    } finally {
      if (active.current === controller && !controller.signal.aborted) setBusy(false);
    }
  }
  const text = detail?.status === "current" && detail.currentRevision && typeof detail.text === "string" ? detail.text.slice(0, 160_000) : null;
  return <div>
    <button type="button" disabled={busy || (token !== null && token.length < 24) || !Number.isSafeInteger(eventId) || eventId <= 0} onClick={() => void inspect()}>{busy ? "保存原文を取得中…" : "保存原文を確認（編集者用）"}</button>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {detail && <details open>
      <summary>保存原文の照合結果 · {detailStatuses[detail.status] ?? "状態不明"}</summary>
      <p className={styles.note}>非公開・読取専用。操作した時点の保存記録です。発信元への再取得や公開は行いません。保存された抽出本文であり、発信元ページ全体を完全に取得したことは保証しません。</p>
      <p className={styles.note}>{detail.sourceName} · イベント {detail.eventId} · {detail.currentRevision ? "現在の版" : "旧版"}{detail.sourceTruncated ? " · 取得時に原文の処理上限へ到達" : ""}</p>
      <p className={styles.note}>投稿 {publicationLabel(detail.publishedAt, detail.publishedOn)} · イベント取得 {timeLabel(detail.observedAt)} · 本文保存 {timeLabel(detail.bodyAt)}</p>
      <p className={styles.note}>初回取得 {timeLabel(detail.firstSeenAt)} · 最終取得 {timeLabel(detail.lastSeenAt)} · 保存原文 {detail.bodyChars ?? "未記録"}文字</p>
      <pre>{`イベント SHA-256: ${detail.eventSha256 ?? "未記録"}\n文書 SHA-256: ${detail.documentSha256 ?? "未記録"}\n本文 SHA-256: ${detail.bodySha256 ?? "未記録"}`}</pre>
      {text !== null ? <>
        <pre>{text}</pre>
        {detail.text && detail.text.length > 160_000 && <p className={styles.note}>画面の表示上限160,000文字に達しています。</p>}
      </> : <p className={styles.note}>同じ版の原文を安全に確認できないため、本文は表示しません。</p>}
    </details>}
  </div>;
}

export function PriceTargetReconciliation({ report, token }: { report: TargetReconciliation; token: string | null }) {
  const { counts, coverage } = report;
  const records = report.records.slice(0, 50);
  return <details className={styles.routes}>
    <summary>目標株価の突合（保存済み・直近{report.windowDays}日）</summary>
    <p className={styles.note}>読取専用。投稿時刻（publishedAt）基準の直近{report.windowDays}日・全発信元が対象で、銘柄・種別フィルターとは独立しています。集計 {timeLabel(report.generatedAt)}</p>
    <p className={styles.note}>保存済みデータのみを対象とし、取得記録は発信元ごとに最大{coverage.rowsPerSourceLimit.toLocaleString("ja-JP")}行の保持上限があります。保持範囲外の投稿・版は含まず、全投稿の網羅性は保証しません。</p>
    <p className={styles.note}>候補の版 {counts.candidateRevisionRows}行 · 重複を除く投稿 {counts.uniqueSourcePosts}件 · 旧版 {counts.supersededRevisionRows}行</p>
    <p className={styles.note}>フィード掲載判定 {counts.publishedPosts}投稿 · 未公開 {counts.unpublishedPosts}投稿 · 解析で除外 {counts.rejectedPosts}投稿</p>
    <p className={styles.note}>解析を通過した変更 {counts.eligibleActions}件 · フィード返却 {counts.returnedActions}件 · フィード上限外 {counts.actionsOutsideFeedLimit}件</p>
    <p className={styles.note}>投稿数・版の行数と、重複をまとめた変更件数は数え方が異なります。投稿の状態は最新の保存版で集計し、旧版がフィードに残る場合は記録の理由に明示します。フィードの上限{coverage.feedLimit}件による省略は、解析での除外とは別です。掲載・返却はバックエンドの判定で、ブラウザーへの配信・表示は未検証です。</p>
    <details><summary>判定理由（候補の版ごと・コード別）</summary>
      {Object.keys(report.reasons).length > 0 ? <ul>{Object.entries(report.reasons).map(([reason, count]) => <li key={reason}><strong>{reason}</strong><span>{count}行</span></li>)}</ul> : <p className={styles.note}>判定理由の記録はありません。</p>}
    </details>
    <details><summary>投稿・版の記録（{records.length}件表示・最大50件）</summary>
      {(report.recordsTruncated || report.records.length > records.length) && <p className={styles.note}>記録一覧は上限に達しているため一部を省略しています。上の集計は表示した記録だけの件数ではありません。</p>}
      {records.length > 0 ? <ul>{records.map((record, index) => {
        const url = safeSourceUrl(record.url);
        return <li key={`${record.sourceId}:${record.eventId}:${record.sha}:${index}`}>
          <strong>{record.sourceId} · {dispositionNames[record.disposition]}</strong>
          <span>理由 {record.reason} · {record.currentRevision ? "現在の版" : "旧版"}</span>
          <small>投稿 {timeLabel(record.publishedAt)} · 取得 {timeLabel(record.observedAt)}</small>
          <small>イベント {record.eventId ?? "未記録"} · SHA {record.sha ?? "未記録"}</small>
          {url ? <a href={url} target="_blank" rel="noopener noreferrer">投稿元を確認 ↗</a> : <small>安全に開ける投稿元URLなし</small>}
          {record.eventId !== null && <SignalSourceInspection token={token} eventId={record.eventId} />}
        </li>;
      })}</ul> : <p className={styles.note}>対象の記録はありません。</p>}
    </details>
  </details>;
}

export default function SignalsPanel({ token }: { token: string | null }) {
  // Credential changes discard data, errors and in-flight requests together.
  return <SignalsSession key={token} token={token} />;
}

function SignalsSession({ token }: { token: string | null }) {
  const [watch, setWatch] = useState(false);
  const [view, setView] = useState("targets");
  const [ticker, setTicker] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{ key: string; data: Queue; displayedAt: string } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const query = new URLSearchParams({ kind: "signals", view, limit: "30", ...(ticker ? { ticker } : {}) }).toString();

  useEffect(() => {
    if (!watch || (token !== null && token.length < 24)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/research/${token === null ? "editor-owner" : "editor"}?${query}`, {
          cache: "no-store", credentials: "same-origin", headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }) }, signal: controller.signal,
        });
        const payload: Queue = await response.json();
        if (token === null && (response.status === 401 || response.status === 403)) window.dispatchEvent(new Event("tech-phase:membership-changed"));
        if (!response.ok || !payload.ok) throw new Error(payload.error || "request-failed");
        if (!stopped) { setState({ key: query, data: payload, displayedAt: new Date().toISOString() }); setFailure(null); }
      } catch {
        if (!stopped) setFailure({ key: query, message: "取得できませんでした。ログイン状態と監視サービスの接続を確認してください。" });
      } finally {
        if (!stopped) timer = setTimeout(load, 15_000);
      }
    }
    void load();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [watch, token, query, refresh]);

  const data = state?.key === query ? state.data : null;
  const displayedAt = state?.key === query ? state.displayedAt : null;
  const error = failure?.key === query ? failure.message : "";
  const tickers = state?.data.tickers ?? [];
  return <section className={styles.panel} aria-labelledby="signals-heading">
    <div className={styles.head}>
      <div><p>製品更新・業界記事</p><h2 id="signals-heading">関連情報の確認待ち</h2></div>
      <button type="button" disabled={(token !== null && token.length < 24)} onClick={() => { setWatch(true); setRefresh(value => value + 1); }}>取得状況を読み込む</button>
    </div>
    <p className={styles.note}>編集用の表示実験です。目標株価の短文はX投稿から機械的に作成し、原発表との照合前です。会員向けには公開していません。</p>
    {error && <p role="alert" className={styles.error}>{error}{data ? " 下記は前回取得時の記録です。" : ""}</p>}
    {watch && !data && !error && <p role="status">読み込み中…</p>}
    {data && <>
      <p className={styles.note}>
        監視処理：{data.enabled && data.workerAlive ? "稼働中" : "停止中・保存済み記録"} · 画面更新 {timeLabel(data.generatedAt)}
      </p>
      {data.xApiUsage && <p className={styles.note}>
        X API：{data.xApiUsage.enabled ? "読取のみ有効" : data.xApiUsage.requested ? "設定不足で停止" : "OFF"}
        {` · 24時間 ${data.xApiUsage.attemptsLast24Hours}/${data.xApiUsage.dailyLimit}回`}
        {` · ${data.xApiUsage.sourceCount}発信元・目標株価／評価変更／決算投稿`}
        {` · 設定上最大 ${data.xApiUsage.configuredMaxRequestsPerDay}回/日`}
        {data.xApiUsage.budgetCapped ? ` · ローカル上限 ${data.xApiUsage.localMaxRequestsPerDay}回/日` : ""}
        {typeof data.xApiUsage.minimumSpacingSeconds === "number" && data.xApiUsage.minimumSpacingSeconds > 0 ? ` · API送信間隔 ${durationLabel(data.xApiUsage.minimumSpacingSeconds)}以上` : ""}
        {typeof data.xApiUsage.minimumSourceSpacingSeconds === "number" && data.xApiUsage.minimumSourceSpacingSeconds > 0 ? ` · 1発信元あたり約${durationLabel(data.xApiUsage.minimumSourceSpacingSeconds)}以上` : ""}
        {data.xApiUsage.pacedUntil ? ` · 次の送信枠 ${timeLabel(data.xApiUsage.pacedUntil)}` : ""}
        {data.xApiUsage.limitReached ? ` · 上限到達（再開 ${timeLabel(data.xApiUsage.nextAvailableAt)}）` : ""}
        {" · 自動公開なし"}
      </p>}
      {data.priceTargetReconciliation && <PriceTargetReconciliation report={data.priceTargetReconciliation} token={token} />}
      <details className={styles.routes}><summary>取得元の状態（{data.routes.length}経路）</summary>
        <ul>{data.routes.map(route => <li key={route.id}><strong>{route.name}</strong>
          <span>{route.error === "x-api-paced" ? "次のAPI送信枠を待機" : route.error ? `取得失敗：${route.error}` : route.succeededAt ? "取得成功" : "未取得"} · 確認間隔 {route.intervalSeconds}秒</span>
          <small>最終成功 {timeLabel(route.succeededAt)} · 直近処理 {route.matchedItems}件{route.pendingArticles > 0 ? ` · 本文取得待ち ${route.pendingArticles}件` : ""}</small>
          {!!route.articleErrors?.length && <details><summary>取得できなかった記事（最大20件）</summary>
            <ul>{route.articleErrors.map(article => <li key={article.url}>
              <a href={article.url} target="_blank" rel="noopener noreferrer">{article.url}</a>
              <small>{article.error} · 最終確認 {timeLabel(article.checkedAt)} · 再試行予定 {timeLabel(article.nextCheckAt)}</small>
            </li>)}</ul>
          </details>}
        </li>)}</ul>
      </details>
      <div className={styles.filters}>
        <label>銘柄<select value={ticker} onChange={event => setTicker(event.target.value)}><option value="">すべて</option>{tickers.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>種別<select value={view} onChange={event => setView(event.target.value)}><option value="targets">目標株価・表示実験</option><option value="ratings">アナリスト評価変更</option><option value="all">すべて</option><option value="new">新規検出</option><option value="changed">内容変更</option><option value="baseline">初回取得</option></select></label>
        <span>{data.counts[view] ?? 0}件中 {data.items.length}件を表示</span>
      </div>
      {view === "targets" && <p className={styles.note}>この画面は15秒ごとに更新します。画面取得 {timeLabel(displayedAt)}。画面を開いていない間の表示時刻は計測しません。</p>}
      <div className={styles.items}>{data.items.map(item => <article key={item.id}>
        <div className={styles.tags}><b>{item.tickers.join(" · ") || "銘柄未判定"}</b><span>{kindNames[item.eventKind]}</span>{item.contentKind && <span>{contentNames[item.contentKind] ?? item.contentKind}</span>}<span>{sourceNames[item.sourceKind]}</span></div>
        {view === "targets" && targetPreview(item.title, item.tickers) ? <>
          <h3>{targetPreview(item.title, item.tickers)?.heading}</h3>
          <p className={styles.previewSummary}>{targetPreview(item.title, item.tickers)?.summary}</p>
          <p className={styles.note}><a href={item.url} target="_blank" rel="noopener noreferrer">投稿元を確認 ↗</a> · 原発表未照合・公開不可</p>
        </> : <h3><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title} ↗</a></h3>}
        <p className={styles.note}>{item.source} · 未確認{item.reuse === "permission-required" ? " · 商用利用条件の確認が必要" : ""}</p>
        <div className={styles.times}><span>X投稿時刻 {publicationLabel(item.publishedAt, item.publishedOn)}</span><span>監視側の取得 {timeLabel(item.observedAt)}</span>{view === "targets" && displayedAt && <span>画面取得 {timeLabel(displayedAt)}</span>}</div>
        <details><summary>関連箇所の原文抜粋</summary><pre>{item.excerpt}</pre><small>機械抽出です。記事全体の要約ではありません。{item.truncated ? " 本文の処理上限に達しています。" : ""}</small></details>
        <SignalSourceInspection token={token} eventId={item.id} />
        {item.diff && <details><summary>前回取得版からの変更</summary><pre>{item.diff}</pre><small>文字列の差分を最大6,000文字で表示。変更の意味は要確認です。</small></details>}
      </article>)}</div>
      {!data.items.length && <p className={styles.note}>この条件の資料はありません。取得元の状態も確認してください。</p>}
    </>}
  </section>;
}
