"use client";

import { useState } from "react";
import Link from "next/link";
import { fetchState, filterSources, intakeCounts, pdfEvidenceCounts, sourceTitle, coverageCounts, providers, providerByTicker, sectorNames, type IntakeSnapshot } from "@/lib/research/intake";
import { useLiveIntake, type MonitorState } from "@/lib/research/use-live-intake";
import styles from "./intake.module.css";

const stateNames = { error: "取得エラー", fetched: "取得済み", unfetched: "未取得" };
const reviewNames = { pending: "確認待ち", approved: "採用", held: "保留", rejected: "却下" };
const historyNames: Record<string, string> = { "first-fetch": "初回取得", changed: "応答の変化を検出", "fetch-error": "取得に失敗", approved: "採用を記録", held: "保留を記録", rejected: "却下を記録" };
const errorNames: Record<string, string> = { "http-403": "配信元が取得を拒否（HTTP 403）", timeout: "応答待ちでタイムアウト", "no-links": "発表リンクを抽出できませんでした", "invalid-pdf": "PDFから根拠本文を抽出できませんでした", "fetch-error": "資料の取得に失敗" };
const impactNames = { positive: "好影響", negative: "悪影響", mixed: "好悪材料", neutral: "中立", uncertain: "判断保留" };
const confidenceNames = { high: "高", medium: "中", low: "低" };
function time(value: string | null) {
  if (!value) return "未取得";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value));
}
function bodyEvidence(source: IntakeSnapshot["sources"][number]) {
  if (!source.sha256) return "未取得";
  if ((source.extracted_chars ?? 0) > 0) return `抽出済み ${source.extracted_chars?.toLocaleString("ja-JP")}文字`;
  return source.content_type === "application/pdf" ? "PDF取得済み・根拠本文の補完待ち" : "原文取得済み・抽出テキストなし";
}
function duration(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "計測待ち";
  return value < 10_000 ? `${(value / 1000).toFixed(1)}秒` : `${Math.round(value / 1000)}秒`;
}
const sourceFormatNames: Record<string, string> = {
  rss: "RSS / Atom", "sec-json": "SEC Submissions JSON", sitemap: "公式サイトマップ",
  "news-json": "企業公式JSON", "twse-material-json": "TWSE重要開示JSON", html: "企業公式HTML",
};
function discoveryEvidence(run: IntakeSnapshot["discoveryRuns"][number]) {
  if (!run.source_format) return "旧記録 · 経路詳細なし";
  const checked = run.sources_checked ?? 1;
  const configured = run.sources_configured ?? 1;
  if (run.status === "degraded") return `${checked}/${configured}経路を確認 · 復旧なし`;
  const format = run.source_format ? sourceFormatNames[run.source_format] ?? run.source_format : "公式経路";
  return `${checked}/${configured}経路目で取得 · ${format}`;
}
function backupStatus(backup: MonitorState["backup"]) {
  if (!backup) return "DB保護：状態取得待ち";
  if (backup.status === "failed" || backup.healthy === false) return "DB保護：要確認（直近バックアップ失敗）";
  if (backup.status === "overdue" || backup.overdue) return "DB保護：要確認（バックアップ期限超過）";
  if (backup.healthy !== true || !backup.lastSuccessAt) return "DB保護：初回バックアップ待ち";
  return `DB保護：正常 · ${backup.backupCount}世代 · 最終成功 ${time(backup.lastSuccessAt)} JST`;
}
function monitorStatus(monitor: MonitorState | null) {
  if (monitor?.health?.status === "degraded") return "自動監視に確認が必要です";
  if (monitor?.health?.status === "starting") return "自動監視を起動しています";
  return "公式発表を自動監視しています";
}
function monitorIssue(monitor: MonitorState | null) {
  const issues = monitor?.health?.issues ?? [];
  if (issues.includes("monitor-stale")) return "巡回更新が停止しています";
  if (issues.includes("backup-failed")) return "DBバックアップに失敗しています";
  if (issues.includes("backup-overdue")) return "DBバックアップが期限を超過しています";
  if (issues.includes("incident-watch-failed")) return "障害台帳の内部監視を再試行しています";
  return null;
}
function incidentStatus(monitor: MonitorState | null) {
  const incidents = monitor?.incidents;
  if (!incidents) return "障害台帳：状態取得待ち";
  const watch = monitor?.incidentWatch?.healthy === true ? "内部監視正常" : "内部監視確認中";
  const delivery = incidents.deliveryEnabled
    ? incidents.deadNotifications
      ? `通知停止 ${incidents.deadNotifications}件 · 再送確認が必要`
      : `通知送信ON · 待機 ${incidents.pendingNotifications}件 · 配信済み ${incidents.deliveredNotifications}件`
    : `通知候補 ${incidents.heldNotifications}件を保留中（外部送信OFF）`;
  if (incidents.open) return `障害台帳：未復旧 ${incidents.open}件 · ${watch} · ${delivery}`;
  return `障害台帳：未復旧なし · ${watch} · ${delivery}`;
}
function cacheStatus(cache: MonitorState["fetchCache"]) {
  if (!cache) return "公式一覧キャッシュ：状態取得待ち";
  const used = (cache.bytes / 1024 / 1024).toFixed(1);
  const maximum = (cache.maxBytes / 1024 / 1024).toFixed(0);
  return `公式一覧キャッシュ：${cache.entries}/${cache.maxEntries}件 · ${used}/${maximum}MiB`;
}

export default function IntakeDashboard({ snapshot: initialSnapshot, titles }: { snapshot: IntakeSnapshot; titles: Record<string, string> }) {
  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState("all");
  const [state, setState] = useState("all");
  const [review, setReview] = useState("all");
  const [sector, setSector] = useState("all");
  const [page, setPage] = useState(1);
  const live = useLiveIntake(initialSnapshot);
  const snapshot = live.snapshot;
  const counts = intakeCounts(snapshot.sources);
  const pdfEvidence = pdfEvidenceCounts(snapshot.sources);
  const coverage = coverageCounts(snapshot);
  const events = snapshot.events ?? [];
  const briefs = snapshot.briefs ?? [];
  const visible = filterSources(snapshot.sources, query, ticker, state, review, titles, sector);
  const selectedProviders = providers.filter(p => (sector === "all" || p.sector === sector) && (ticker === "all" || ticker === p.ticker));
  const displayed = visible.slice((page - 1) * 20, page * 20);
  const pages = Math.max(1, Math.ceil(visible.length / 20));
  const title = (url: string) => titles[url] || sourceTitle(url);
  function reset() { setQuery(""); setTicker("all"); setState("all"); setReview("all"); setSector("all"); setPage(1); }
  function chooseSector(value: string) { setSector(value); setTicker("all"); setPage(1); }
  return <div className={styles.app}>
    <a className={styles.skip} href="#intake-main">本文へ移動</a>
    <header className={styles.header}><Link href="/research" className={styles.brand}><b>TP</b><span>TECH PHASE<small>RESEARCH / OPERATIONS</small></span></Link><span className={styles.badge}>運営用プレビュー</span></header>
    <main id="intake-main" className={styles.main}>
      <div className={styles.heading}><div><p className={styles.eyebrow}>AI COMPANY COVERAGE</p><h1>AI関連銘柄の資料・取得状況</h1><p>企業公式・取引所・SECの一次情報から、原文と照合する資料を選びます。</p></div><div className={styles.headingLinks}><Link href="/research/review">速報レビュー →</Link><Link href="/research">リサーチ画面へ ↗</Link></div></div>
      <aside className={styles.notice}><strong>{live.mode === "automatic" ? monitorStatus(live.monitor) : "自動監視サービスの接続待ち"}</strong><span>{live.mode === "automatic" ? `最終巡回：${time(live.monitor?.lastCycleAt ?? null)} JST` : `保存記録の出力日時：${time(snapshot.generatedAt)} JST`}</span>{live.mode === "automatic" && <><span>直近巡回：{duration(live.monitor?.lastCycleDurationMs)}（{live.monitor?.lastCycleCompanies ?? 0}社）</span><span>{cacheStatus(live.monitor?.fetchCache)}</span><span>{backupStatus(live.monitor?.backup)}</span><span>{incidentStatus(live.monitor)}</span>{monitorIssue(live.monitor) && <span role="alert" className={styles.alert}>運用警告：{monitorIssue(live.monitor)}</span>}</>}<p>{live.mode === "automatic" ? "公式経路を銘柄ごとに3〜5秒の基準間隔で巡回します。間隔は保証速度ではなく、直近応答時間と検知後の本文取得時間を別に実測します。" : "現在は保存済み記録を表示しています。監視サービス接続後は3秒ごとに自動更新されます。"}</p></aside>
      <section aria-labelledby="events-title" className={styles.queue}><div className={styles.sectionTitle}><h2 id="events-title">新着の公式発表</h2><span>初回取り込みを除く自動検知：{events.length}件</span></div>
        <p className={styles.coverageNote}>監視開始前の過去資料は速報として扱いません。ここには監視開始後に新しく現れた公式URLだけを表示します。発表元の公開時刻が秒単位で得られない場合、公開から検知までの時間は未計測です。</p>
        {events.length === 0 ? <div className={styles.empty}><h3>監視開始後の新着はまだありません</h3><p>常駐監視の接続後、新しい公式発表を検知すると自動で追加されます。</p></div> : <ul className={styles.sources}>{events.slice(0, 20).map(event => <li key={event.id}><article className={styles.source}>
          <div className={styles.tags}><b>{event.ticker}</b><span className={styles.good}>公式URLを新規検知</span></div>
          <h3>{event.title || title(event.url)}</h3>
          <dl className={styles.dates}><div><dt>初回検知（JST）</dt><dd>{time(event.detected_at)}</dd></div><div><dt>本文取得（JST）</dt><dd>{time(event.body_fetched_at ?? null)}</dd></div><div><dt>検知→本文取得</dt><dd>{duration(event.detection_to_body_ms)}</dd></div><div><dt>発表日</dt><dd>{event.published_on ?? "原文で確認"}</dd></div></dl>
          <div className={styles.sourceFooter}><a href={event.url} target="_blank" rel="noopener noreferrer">公式原文を開く ↗</a><span>要約前の確定情報</span></div>
        </article></li>)}</ul>}
      </section>
      <section aria-labelledby="briefs-title" className={styles.queue}><div className={styles.sectionTitle}><h2 id="briefs-title">人間確認済みの速報要約</h2><span>公開ゲート通過：{briefs.length}件</span></div>
        <p className={styles.coverageNote}>現在の公式原文とSHAが一致し、根拠引用・数値を照合したうえで人間が承認した版だけを表示します。未承認、原文変更、最新取得エラーのある要約は表示しません。</p>
        {briefs.length === 0 ? <div className={styles.empty}><h3>承認済みの速報要約はまだありません</h3><p>下書きは運営レビューを通過するまで公開候補に含めません。</p></div> : <ul className={styles.briefs}>{briefs.slice(0, 12).map(brief => <li key={`${brief.url}-${brief.source_sha256}`}><article className={styles.brief}>
          <div className={styles.briefHead}><div className={styles.tags}><b>{brief.ticker}</b><span className={styles.good}>人間確認済み</span><span className={styles.neutral}>{impactNames[brief.impact_label]}</span></div><span className={styles.confidence}>確信度 {confidenceNames[brief.confidence]}</span></div>
          <h3>{brief.title || title(brief.url)}</h3>
          <div className={styles.briefCopy}><section><h4>確認できた事実</h4><p>{brief.summary_ja}</p></section><section><h4>影響と未確認事項</h4><p>{brief.impact_ja}</p></section></div>
          <details className={styles.briefEvidence}><summary>照合した公式原文の抜粋</summary><div><section><h4>事実要約の根拠</h4>{brief.evidence.summary.map((item, index) => <blockquote key={`summary-${index}`}>{item.text}{item.truncated ? <small>（表示上限のため続きは公式原文で確認）</small> : null}</blockquote>)}</section><section><h4>影響判断の根拠</h4>{brief.evidence.impact.map((item, index) => <blockquote key={`impact-${index}`}>{item.text}{item.truncated ? <small>（表示上限のため続きは公式原文で確認）</small> : null}</blockquote>)}</section></div><p>英語原文から人間が照合した抜粋です。解釈や重要度ではありません。</p></details>
          <dl className={styles.briefDates}><div><dt>発表日</dt><dd>{brief.published_on ?? "原文で確認"}</dd></div><div><dt>初回検知（JST）</dt><dd>{time(brief.detected_at)}</dd></div><div><dt>公式原文の最終確認（JST）</dt><dd>{time(brief.source_checked_at)}</dd></div><div><dt>下書き作成（JST）</dt><dd>{time(brief.generated_at)}</dd></div><div><dt>編集確認（JST）</dt><dd>{time(brief.reviewed_at)}</dd></div><div><dt>作成方法</dt><dd>{brief.generation_method === "ai-assisted" ? "AI下書き＋人間確認" : "人間作成"}</dd></div></dl>
          <div className={styles.sourceFooter}><a href={brief.url} target="_blank" rel="noopener noreferrer">根拠となる公式原文 ↗</a><span>原文識別値 {brief.source_sha256.slice(0, 12)}…</span></div>
        </article></li>)}</ul>}
      </section>
      <section aria-label="銘柄の対応状況" className={styles.stats}>
        {[["登録銘柄", coverage.registered], ["一覧取得に成功", coverage.discovered], ["一覧の確認が必要", coverage.needsCheck], ["一覧未検証", coverage.untested]].map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}<small>銘柄</small></strong></div>)}
      </section>
      <nav aria-label="分野で絞り込み" className={styles.sectors}>{[["all", "すべて"], ...Object.entries(sectorNames)].map(([key, label]) => <button key={key} aria-pressed={sector === key} onClick={() => chooseSector(key)}>{label}</button>)}</nav>
      <section aria-labelledby="health-title"><div className={styles.sectionTitle}><h2 id="health-title">公式一覧の取得状況</h2><span>一覧と本文の取得は別々に確認</span></div>
        <p className={styles.coverageNote}>企業公式の発表・ブログに加え、対象企業のSEC提出書類と取引所の重要開示を補完利用します。AI以外の発表や過去分も含みます。<br />PDF根拠：抽出済み {pdfEvidence.extracted}件 ／ 補完待ち {pdfEvidence.pending}件 ／ エラー {pdfEvidence.error}件（全{pdfEvidence.total}件）</p>
        <div className={styles.health}>{selectedProviders.map(provider => {
          const symbol = provider.ticker;
          const runs = snapshot.discoveryRuns.filter(r => r.ticker === symbol).toSorted((a, b) => b.id - a.id);
          const latest = runs[0];
          const totals = intakeCounts(snapshot.sources.filter(s => s.ticker === symbol));
          const available = latest?.status === "ok" || latest?.status === "fallback";
          const monitor = live.monitor?.companies?.[symbol];
          return <article key={symbol}><div className={styles.healthTop}><h3>{symbol}</h3><span className={available ? styles.good : styles.warning}>{latest?.status === "ok" ? "公式経路から取得" : latest?.status === "fallback" ? "公式バックアップ経路で取得" : latest ? "一覧の確認が必要" : "一覧未検証"}</span></div>
            <p className={styles.companyName}>{provider.name} <small>{sectorNames[provider.sector]}</small></p>
            <p>{latest?.status === "ok" ? (provider.format === "twse-material-json" ? `取引所の当日重要開示 ${latest.candidates}件` : `${latest.candidates}件のリンクを検出`) : latest?.status === "fallback" ? `企業サイトを補完し、公式提出書類を${latest.candidates}件検出` : errorNames[latest?.error ?? ""] || "取得記録なし"}</p>
            <p className={styles.muted}>本文・PDF：取得済み {totals.fetched} ／ 未取得 {totals.unfetched} ／ エラー {totals.error}</p>
            <p className={styles.meta}>一覧の確認日時：{latest ? time(latest.at) : "未確認"} JST</p>
            {latest && <p className={styles.meta}>取得経路の証跡：{discoveryEvidence(latest)}</p>}
            {monitor && <p className={styles.meta}>基準間隔 {monitor.basePollSeconds ?? monitor.nextPollSeconds ?? "—"}秒 ／ 直近の公式応答 {duration(monitor.requestDurationMs)}{monitor.nextPollSeconds && monitor.basePollSeconds && monitor.nextPollSeconds > monitor.basePollSeconds ? ` ／ 次回まで${monitor.nextPollSeconds}秒（失敗時バックオフ）` : ""}</p>}
            <div className={styles.cardActions}><Link href={`/research/companies/${symbol}`}>銘柄ページ →</Link><a href={provider.indexUrl} target="_blank" rel="noopener noreferrer">公式{provider.format === "rss" ? "RSS" : "一覧"} ↗</a><button disabled={!totals.total} onClick={() => { setTicker(symbol); setQuery(""); setState("all"); setReview("all"); setPage(1); requestAnimationFrame(() => document.getElementById("queue-title")?.scrollIntoView({ block: "start" })); }}>資料を表示（{totals.total}）</button></div>
            <details className={styles.runHistory}><summary>{symbol}の一覧取得履歴（{runs.length}件）</summary><ul>{runs.map(r => <li key={r.id}><time>{time(r.at)} JST</time><span>{r.status === "ok" ? `${r.candidates}件検出` : r.status === "fallback" ? `公式バックアップで${r.candidates}件検出` : errorNames[r.error ?? ""] || "取得異常"}<small>{discoveryEvidence(r)}</small></span></li>)}</ul></details>
          </article>;
        })}</div>
      </section>
      <section aria-labelledby="queue-title" className={styles.queue}><div className={styles.sectionTitle}><h2 id="queue-title">確認する資料</h2><span>編集上の確認待ち：{counts.pending}件</span></div>
        <p className={styles.coverageNote}>全{counts.total}資料 ／ 取得済み {counts.fetched} ／ 未取得 {counts.unfetched} ／ エラー {counts.error}　表示分野：{sector === "all" ? "すべて" : sectorNames[sector]}</p>
        <div className={styles.filters}>
          <label className={styles.search}>資料名・会社名・URLを検索<input type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="NVIDIA、financial、AI…" /></label>
          <label>銘柄<select value={ticker} onChange={e => { setTicker(e.target.value); setPage(1); }}><option value="all">すべての銘柄</option>{providers.filter(p => sector === "all" || p.sector === sector).map(p => <option key={p.ticker} value={p.ticker}>{p.ticker} · {p.name}</option>)}</select></label>
          <label>取得状態<select value={state} onChange={e => { setState(e.target.value); setPage(1); }}><option value="all">すべての取得状態</option><option value="error">取得エラー</option><option value="unfetched">未取得</option><option value="fetched">取得済み</option></select></label>
          <label>編集状態<select value={review} onChange={e => { setReview(e.target.value); setPage(1); }}><option value="all">すべての編集状態</option>{Object.entries(reviewNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        </div>
        <div className={styles.results}><p aria-live="polite">{visible.length}件が該当 · {page} / {pages}ページ</p><button onClick={reset}>絞り込みを解除</button></div>
        {visible.length === 0 ? <div className={styles.empty}><h3>条件に合う資料はありません</h3><p>検索語や取得状態を変更してください。</p><button onClick={reset}>すべての資料を表示</button></div> : <ul className={styles.sources}>{displayed.map(s => {
          const status = fetchState(s);
          const history = snapshot.history.filter(h => h.url === s.url);
          return <li key={s.url}><article className={styles.source}>
            <div className={styles.tags}><b>{s.ticker}</b><span className={styles.neutral}>{sectorNames[providerByTicker[s.ticker]?.sector]}</span><span className={status === "error" ? styles.warning : status === "fetched" ? styles.good : styles.neutral}>{stateNames[status]}</span><span className={styles.neutral}>{reviewNames[s.status]}</span></div>
            <h3>{title(s.url)}</h3><p className={styles.domain}>{new URL(s.url).hostname}</p>
            {s.error && <p className={styles.error}>{errorNames[s.error] || "資料の取得に失敗"}。{s.sha256 ? "以前の取得記録はありますが、最新の試行は失敗しています。" : "本文は未取得です。"}</p>}
            <dl className={styles.dates}><div><dt>資料の発表日</dt><dd>{s.published_on ?? "未確認"}</dd></div><div><dt>初回の検知日時（JST）</dt><dd>{time(s.discovered_at)}</dd></div><div><dt>最後の取得試行（JST）</dt><dd>{time(s.checked_at)}</dd></div><div><dt>要約用の原文証拠</dt><dd>{bodyEvidence(s)}</dd></div></dl>
            <div className={styles.sourceFooter}><a href={s.url} target="_blank" rel="noopener noreferrer">公式原文を開く ↗</a><span>取得の成功は、内容の確認完了を意味しません</span></div>
            <details className={styles.history}><summary>資料の取得・確認履歴（{history.length}件）</summary>
              {s.sha256 && <p className={styles.fingerprint}>最後に取得した内容の識別値 <code>{s.sha256}</code></p>}
              {history.length ? <ol>{history.map(h => <li key={h.id}><time>{time(h.at)} JST</time><strong>{historyNames[h.kind] || h.kind}</strong>{h.sha256 && <code>{h.sha256.slice(0, 12)}…</code>}</li>)}</ol> : <p>資料取得・編集判断の記録はまだありません。</p>}
              <p className={styles.meta}>担当者名・判断理由は、この共有用の記録に含めていません。応答の変化は、財務内容の訂正と確定したものではありません。</p>
            </details>
          </article></li>;
        })}</ul>}
        {pages > 1 && <nav aria-label="資料のページ切り替え" className={styles.pagination}><button disabled={page === 1} onClick={() => { setPage(p => p - 1); requestAnimationFrame(() => document.getElementById("queue-title")?.scrollIntoView()); }}>前の20件</button><span>{page} / {pages}</span><button disabled={page === pages} onClick={() => { setPage(p => p + 1); requestAnimationFrame(() => document.getElementById("queue-title")?.scrollIntoView()); }}>次の20件</button></nav>}
      </section>
      <footer className={styles.footer}>TECH PHASE RESEARCH · 取得状況の確認版<br />新着の網羅性・速度を保証する画面ではありません。</footer>
    </main>
  </div>;
}
