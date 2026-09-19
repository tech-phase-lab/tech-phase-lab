"use client";

import { useState } from "react";
import Link from "next/link";
import { fetchState, filterSources, intakeCounts, sourceTitle, type IntakeSnapshot } from "@/lib/research/intake";
import styles from "./intake.module.css";

const stateNames = { error: "取得エラー", fetched: "取得済み", unfetched: "未取得" };
const reviewNames = { pending: "確認待ち", approved: "採用", held: "保留", rejected: "却下" };
const historyNames: Record<string, string> = { "first-fetch": "初回取得", changed: "応答の変化を検出", "fetch-error": "取得に失敗", approved: "採用を記録", held: "保留を記録", rejected: "却下を記録" };
const errorNames: Record<string, string> = { "http-403": "配信元が取得を拒否（HTTP 403）", timeout: "応答待ちでタイムアウト", "no-links": "発表リンクを抽出できませんでした", "fetch-error": "資料の取得に失敗" };
function time(value: string | null) {
  if (!value) return "未取得";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

export default function IntakeDashboard({ snapshot, titles }: { snapshot: IntakeSnapshot; titles: Record<string, string> }) {
  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState("all");
  const [state, setState] = useState("all");
  const [review, setReview] = useState("all");
  const counts = intakeCounts(snapshot.sources);
  const visible = filterSources(snapshot.sources, query, ticker, state, review, titles);
  const title = (url: string) => titles[url] || sourceTitle(url);
  function reset() { setQuery(""); setTicker("all"); setState("all"); setReview("all"); }
  return <div className={styles.app}>
    <a className={styles.skip} href="#intake-main">本文へ移動</a>
    <header className={styles.header}><Link href="/research" className={styles.brand}><b>TP</b><span>TECH PHASE<small>RESEARCH / OPERATIONS</small></span></Link><span className={styles.badge}>運営用プレビュー</span></header>
    <main id="intake-main" className={styles.main}>
      <div className={styles.heading}><div><p className={styles.eyebrow}>SOURCE INTAKE</p><h1>資料の取得・確認状況</h1><p>取得結果を確認し、原文と照合する資料を選びます。</p></div><Link href="/research">リサーチ画面へ ↗</Link></div>
      <aside className={styles.notice}><strong>保存した取得記録を表示しています</strong><span>記録の出力日時：{time(snapshot.generatedAt)} JST</span><p>常時監視・自動更新は未接続です。初回取得には過去資料も含まれます。この画面から採用・公開の操作は行いません。</p></aside>
      <section aria-label="資料の取得件数" className={styles.stats}>
        {[["登録資料", counts.total], ["取得済み", counts.fetched], ["未取得", counts.unfetched], ["取得エラー", counts.error]].map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}<small>件</small></strong></div>)}
      </section>
      <section aria-labelledby="health-title"><div className={styles.sectionTitle}><h2 id="health-title">公式一覧の取得状況</h2><span>一覧と本文の取得は別々に確認</span></div>
        <div className={styles.health}>{["NBIS", "MU"].map(symbol => {
          const runs = snapshot.discoveryRuns.filter(r => r.ticker === symbol).toSorted((a, b) => b.id - a.id);
          const latest = runs[0];
          const totals = intakeCounts(snapshot.sources.filter(s => s.ticker === symbol));
          return <article key={symbol}><div className={styles.healthTop}><h3>{symbol}</h3><span className={latest?.status === "ok" ? styles.good : styles.warning}>{latest?.status === "ok" ? "一覧取得に成功" : "一覧の確認が必要"}</span></div>
            <p>{latest?.status === "ok" ? `${latest.candidates}件の発表リンクを検出（当該一覧ページ）` : errorNames[latest?.error ?? ""] || "取得記録なし"}</p>
            <p className={styles.muted}>本文・PDF：取得済み {totals.fetched} ／ 未取得 {totals.unfetched} ／ エラー {totals.error}</p>
            <p className={styles.meta}>一覧の確認日時：{latest ? time(latest.at) : "未確認"} JST</p>
            {latest?.index_url && <a href={latest.index_url} target="_blank" rel="noopener noreferrer">確認した公式一覧 ↗</a>}
            <details className={styles.runHistory}><summary>一覧の取得履歴（{runs.length}件）</summary><ul>{runs.map(r => <li key={r.id}><time>{time(r.at)} JST</time><span>{r.status === "ok" ? `${r.candidates}件検出` : errorNames[r.error ?? ""] || "取得異常"}</span></li>)}</ul></details>
          </article>;
        })}</div>
      </section>
      <section aria-labelledby="queue-title" className={styles.queue}><div className={styles.sectionTitle}><h2 id="queue-title">確認する資料</h2><span>編集上の確認待ち：{counts.pending}件</span></div>
        <div className={styles.filters}>
          <label className={styles.search}>資料名・URLを検索<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Palantir、financial、MU…" /></label>
          <label>銘柄<select value={ticker} onChange={e => setTicker(e.target.value)}><option value="all">すべての銘柄</option><option>NBIS</option><option>MU</option></select></label>
          <label>取得状態<select value={state} onChange={e => setState(e.target.value)}><option value="all">すべての取得状態</option><option value="error">取得エラー</option><option value="unfetched">未取得</option><option value="fetched">取得済み</option></select></label>
          <label>編集状態<select value={review} onChange={e => setReview(e.target.value)}><option value="all">すべての編集状態</option>{Object.entries(reviewNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        </div>
        <div className={styles.results}><p aria-live="polite">{visible.length} / {counts.total} 件を表示</p><button onClick={reset}>絞り込みを解除</button></div>
        {visible.length === 0 ? <div className={styles.empty}><h3>条件に合う資料はありません</h3><p>検索語や取得状態を変更してください。</p><button onClick={reset}>すべての資料を表示</button></div> : <ul className={styles.sources}>{visible.map(s => {
          const status = fetchState(s);
          const history = snapshot.history.filter(h => h.url === s.url);
          return <li key={s.url}><article className={styles.source}>
            <div className={styles.tags}><b>{s.ticker}</b><span className={status === "error" ? styles.warning : status === "fetched" ? styles.good : styles.neutral}>{stateNames[status]}</span><span className={styles.neutral}>{reviewNames[s.status]}</span></div>
            <h3>{title(s.url)}</h3><p className={styles.domain}>{new URL(s.url).hostname}</p>
            {s.error && <p className={styles.error}>{errorNames[s.error] || "資料の取得に失敗"}。{s.sha256 ? "以前の取得記録はありますが、最新の試行は失敗しています。" : "本文は未取得です。"}</p>}
            <dl className={styles.dates}><div><dt>資料の発表日</dt><dd>{s.published_on ?? "未確認"}</dd></div><div><dt>初回の検知日時（JST）</dt><dd>{time(s.discovered_at)}</dd></div><div><dt>最後の取得試行（JST）</dt><dd>{time(s.checked_at)}</dd></div></dl>
            <div className={styles.sourceFooter}><a href={s.url} target="_blank" rel="noopener noreferrer">公式原文を開く ↗</a><span>取得の成功は、内容の確認完了を意味しません</span></div>
            <details className={styles.history}><summary>資料の取得・確認履歴（{history.length}件）</summary>
              {s.sha256 && <p className={styles.fingerprint}>最後に取得した内容の識別値 <code>{s.sha256}</code></p>}
              {history.length ? <ol>{history.map(h => <li key={h.id}><time>{time(h.at)} JST</time><strong>{historyNames[h.kind] || h.kind}</strong>{h.sha256 && <code>{h.sha256.slice(0, 12)}…</code>}</li>)}</ol> : <p>資料取得・編集判断の記録はまだありません。</p>}
              <p className={styles.meta}>担当者名・判断理由は、この共有用の記録に含めていません。応答の変化は、財務内容の訂正と確定したものではありません。</p>
            </details>
          </article></li>;
        })}</ul>}
      </section>
      <footer className={styles.footer}>TECH PHASE RESEARCH · 取得状況の確認版<br />新着の網羅性・速度を保証する画面ではありません。</footer>
    </main>
  </div>;
}
