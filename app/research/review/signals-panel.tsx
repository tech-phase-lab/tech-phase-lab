"use client";

import { useEffect, useState } from "react";
import styles from "./signals-panel.module.css";

type Signal = {
  id: number; source: string; sourceKind: string; reuse: string; url: string; title: string;
  tickers: string[]; eventKind: string; publishedAt: string | null; observedAt: string;
  excerpt: string; diff: string; truncated: boolean;
};
type Route = {
  id: string; name: string; kind: string; intervalSeconds: number; checkedAt: string | null;
  succeededAt: string | null; nextCheckAt: string | null; error: string | null; matchedItems: number; pendingArticles: number;
  articleErrors?: { url: string; error: string; nextCheckAt: string | null; checkedAt: string | null }[];
};
type Queue = {
  ok: boolean; error?: string; items: Signal[]; routes: Route[]; tickers: string[];
  counts: Record<string, number>; enabled: boolean; workerAlive: boolean; generatedAt: string;
  xApiUsage?: { requested: boolean; configured: boolean; enabled: boolean; attemptsLast24Hours: number;
    dailyLimit: number; limitReached: boolean; nextAvailableAt: string | null; sourceCount: number;
    scope: string; configuredMaxRequestsPerDay: number; localMaxRequestsPerDay: number; budgetCapped: boolean };
};
const kindNames: Record<string, string> = {
  baseline: "初回取得・過去資料", new: "新規検出・発表時刻は要確認", changed: "内容変更",
};
const sourceNames: Record<string, string> = {
  "external-research": "外部調査", "publisher-update": "発信元の更新", "official-document": "公式ドキュメント",
};
const timeLabel = (value: string | null) => value ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false }) + " JST" : "未取得";

export default function SignalsPanel({ token }: { token: string }) {
  const [watch, setWatch] = useState(false);
  const [view, setView] = useState("all");
  const [ticker, setTicker] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{ key: string; data: Queue } | null>(null);
  const [error, setError] = useState("");
  const query = new URLSearchParams({ kind: "signals", view, limit: "30", ...(ticker ? { ticker } : {}) }).toString();

  useEffect(() => {
    if (!watch || token.length < 24) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/research/editor?${query}`, {
          cache: "no-store", headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        const payload: Queue = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || "request-failed");
        if (!stopped) { setState({ key: query, data: payload }); setError(""); }
      } catch {
        if (!stopped) setError("取得できませんでした。編集用トークンと監視サービスの接続を確認してください。");
      } finally {
        if (!stopped) timer = setTimeout(load, 15_000);
      }
    }
    void load();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [watch, token, query, refresh]);

  const data = state?.key === query ? state.data : null;
  const tickers = state?.data.tickers ?? [];
  return <section className={styles.panel} aria-labelledby="signals-heading">
    <div className={styles.head}>
      <div><p>製品更新・業界記事</p><h2 id="signals-heading">関連情報の確認待ち</h2></div>
      <button type="button" disabled={token.length < 24} onClick={() => { setWatch(true); setRefresh(value => value + 1); }}>取得状況を読み込む</button>
    </div>
    <p className={styles.note}>本文から関連銘柄を自動照合しています。言及は事実確認や重要度の判定を意味しません。自動公開は行いません。</p>
    {error && <p role="alert" className={styles.error}>{error}{data ? " 下記は前回取得時の記録です。" : ""}</p>}
    {watch && !data && !error && <p role="status">読み込み中…</p>}
    {data && <>
      <p className={styles.note}>
        監視処理：{data.enabled && data.workerAlive ? "稼働中" : "停止中・保存済み記録"} · 画面更新 {timeLabel(data.generatedAt)}
      </p>
      {data.xApiUsage && <p className={styles.note}>
        X API：{data.xApiUsage.enabled ? "読取のみ有効" : data.xApiUsage.requested ? "設定不足で停止" : "OFF"}
        {` · 24時間 ${data.xApiUsage.attemptsLast24Hours}/${data.xApiUsage.dailyLimit}回`}
        {` · ${data.xApiUsage.sourceCount}発信元・目標株価と決算投稿`}
        {` · 設定上最大 ${data.xApiUsage.configuredMaxRequestsPerDay}回/日`}
        {data.xApiUsage.budgetCapped ? ` · ローカル上限 ${data.xApiUsage.localMaxRequestsPerDay}回/日` : ""}
        {data.xApiUsage.limitReached ? ` · 上限到達（再開 ${timeLabel(data.xApiUsage.nextAvailableAt)}）` : ""}
        {" · 自動公開なし"}
      </p>}
      <details className={styles.routes}><summary>取得元の状態（{data.routes.length}経路）</summary>
        <ul>{data.routes.map(route => <li key={route.id}><strong>{route.name}</strong>
          <span>{route.error ? `取得失敗：${route.error}` : route.succeededAt ? "取得成功" : "未取得"} · 確認間隔 {route.intervalSeconds}秒</span>
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
        <label>種別<select value={view} onChange={event => setView(event.target.value)}><option value="all">すべて</option><option value="new">新規検出</option><option value="changed">内容変更</option><option value="baseline">初回取得</option></select></label>
        <span>{data.counts[view] ?? 0}件中 {data.items.length}件を表示</span>
      </div>
      <div className={styles.items}>{data.items.map(item => <article key={item.id}>
        <div className={styles.tags}><b>{item.tickers.join(" · ") || "銘柄未判定"}</b><span>{kindNames[item.eventKind]}</span><span>{sourceNames[item.sourceKind]}</span></div>
        <h3><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title} ↗</a></h3>
        <p className={styles.note}>{item.source} · 未確認{item.reuse === "permission-required" ? " · 商用利用条件の確認が必要" : ""}</p>
        <div className={styles.times}><span>発信元の公表時刻 {timeLabel(item.publishedAt)}</span><span>取得時刻 {timeLabel(item.observedAt)}</span></div>
        <details><summary>関連箇所の原文抜粋</summary><pre>{item.excerpt}</pre><small>機械抽出です。記事全体の要約ではありません。{item.truncated ? " 本文の処理上限に達しています。" : ""}</small></details>
        {item.diff && <details><summary>前回取得版からの変更</summary><pre>{item.diff}</pre><small>文字列の差分を最大6,000文字で表示。変更の意味は要確認です。</small></details>}
      </article>)}</div>
      {!data.items.length && <p className={styles.note}>この条件の資料はありません。取得元の状態も確認してください。</p>}
    </>}
  </section>;
}
