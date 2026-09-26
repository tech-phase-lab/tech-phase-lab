"use client";

import Link from "next/link";
import { sectorNamesEn, type CoverageCompany } from "@/lib/research/intake";
import { verifiedChangeByTicker, type VerifiedChangeMetric } from "@/lib/research/verified-changes";
import { useResearchLanguage } from "../use-research-language";
import base from "../research.module.css";
import styles from "./coverage-company.module.css";
import CompanySwitcher from "./company-switcher";

const errorNames: Record<string, { ja: string; en: string }> = {
  "http-403": { ja: "公式サイトが自動取得を拒否", en: "Official site rejected the automated request" },
  timeout: { ja: "公式サイトが時間内に応答しませんでした", en: "Official site did not respond before timeout" },
  "no-links": { ja: "現在の方法では発表リンクを抽出できませんでした", en: "No release links were found with the current method" },
};
function time(value: string | null, lang: "ja" | "en") {
  if (!value) return lang === "ja" ? "未確認" : "Not checked";
  return new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function metricValue(metric: VerifiedChangeMetric, value: number | null, lang: "ja" | "en") {
  if (value === null) return lang === "ja" ? "非表示" : "Not shown";
  if (metric.unit === "percent") return `${value.toFixed(1)}%`;
  if (metric.unit === "krw-trillion") return `₩${value.toFixed(value >= 10 ? 1 : 3)}T`;
  const currency = metric.unit === "eur-billion" ? "€" : "$";
  return `${currency}${value.toFixed(value >= 10 ? 1 : 3)}B`;
}

export default function CoverageCompanyDashboard({ company, companies, generatedAt }: { company: CoverageCompany; companies: Pick<CoverageCompany, "ticker" | "name">[]; generatedAt: string }) {
  const [lang, setLang] = useResearchLanguage();
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const discoveryLabel = company.discovery.status === "ok" ? t("企業公式一覧から取得", "Company release list retrieved") : company.discovery.status === "fallback" ? t("公式バックアップ経路で取得", "Official fallback retrieved") : company.discovery.status === "degraded" ? t("一覧の確認が必要", "Release list needs attention") : t("一覧未検証", "Release list untested");
  const discoveryAvailable = company.discovery.status === "ok" || company.discovery.status === "fallback";
  const error = company.discovery.error ? errorNames[company.discovery.error]?.[lang] ?? t("取得時にエラーを検出", "Retrieval error detected") : null;
  const verified = verifiedChangeByTicker[company.ticker];

  return <div className={base.app} lang={lang}>
    <a className={base.skip} href="#coverage-main">{t("本文へ移動", "Skip to content")}</a>
    <header className={base.header}>
      <Link href="/research" className={base.brand} aria-label="Tech Phase Research"><span className={base.mark}>TP<span /></span><span>TECH PHASE<small>RESEARCH</small></span></Link>
      <nav className={base.primaryNav} aria-label={t("メインメニュー", "Main navigation")}><Link href="/research">{t("ホーム", "Home")}</Link><Link href="/research#what-changed" aria-current="page">{t("何が変わった？", "What changed?")}</Link><Link href="/research/stocks">{t("米国株を探す", "Find stocks")}</Link><Link href="/research#metrics">{t("決算・指標", "Financials")}</Link><Link className={base.proNav} href="/research#tech-phase-pro">Tech Phase PRO</Link></nav>
      <div className={base.headerRight}><span className={base.edition}>COMPANY WATCH <span>{companies.length}</span></span><div className={base.languages} aria-label={t("言語", "Language")}><button onClick={() => setLang("ja")} aria-pressed={lang === "ja"}>日本語</button><button onClick={() => setLang("en")} aria-pressed={lang === "en"}>EN</button></div></div>
    </header>
    <main id="coverage-main" className={styles.main}>
      <CompanySwitcher ticker={company.ticker} companies={companies} lang={lang} />
      <aside className={styles.snapshot}><strong>{t("保存した取得記録", "SAVED INTAKE SNAPSHOT")}</strong><span>{t("出力日時", "Generated")}: {time(generatedAt, lang)} JST</span><p>{t("このページは保存時点の記録で、自動更新されません。現在の監視状況は取得状況画面で確認できます。", "This page is a saved snapshot and does not update automatically. Check the intake page for current monitoring status.")} <Link href="/research/intake">{t("取得状況を見る →", "View intake status →")}</Link></p></aside>
      <header className={styles.companyHeading}><div><p className={styles.eyebrow}>{lang === "ja" ? company.sector : sectorNamesEn[company.sectorKey]}</p><h1>{company.ticker} <span>{company.name}</span></h1><p>{t("公式発表から、前回との変化を照合するための銘柄ページ。", "A company page for comparing changes across official releases.")}</p></div><span className={`${styles.status} ${discoveryAvailable ? styles.good : styles.warning}`}>{discoveryLabel}</span></header>

      <nav className={styles.sectionNav} aria-label={t("ページ内の項目", "On this page")}>
        <a href="#changed-title">{verified ? t("何が変わった？", "What changed?") : t("確認状況", "Review progress")}</a>
        <a href="#sources-title">{t("公式資料", "Official sources")}</a>
        <a href="#next-title">{t("次の確認点", "Next checks")}</a>
      </nav>

      <section className={styles.section} aria-labelledby="changed-title"><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>01 / WHAT CHANGED?</p><h2 id="changed-title">{verified ? verified.title[lang] : t("変化を伝えるまでの確認状況", "Progress toward a verified change")}</h2></div><span>{verified ? `${verified.previousPeriod} → ${verified.currentPeriod}` : t("数値比較は未作成", "Numeric comparison not prepared")}</span></div>
        {verified ? <div className={styles.verifiedChange}>
          <div className={styles.metricGrid}>{verified.metrics.map((metric) => <article key={metric.id}><span>{metric.label[lang]}</span><div><small>{verified.previousPeriod}</small><strong>{metricValue(metric, metric.previous, lang)}</strong><b>→</b><small>{verified.currentPeriod}</small><strong>{metricValue(metric, metric.current, lang)}</strong></div><em>{metric.change.value > 0 ? "+" : ""}{metric.change.value.toFixed(1)}{metric.change.unit === "pp" ? lang === "ja" ? "pt" : "pp" : "%"}{metric.change.companyReported ? ` ${t("会社発表", "reported")}` : ""}</em><p>{metric.note[lang]}</p></article>)}</div>
          <div className={styles.changeReading}><article><span>{t("読み取れる変化", "VERIFIED READING")}</span><p>{verified.reading[lang]}</p></article><article><span>{verified.outlookHeading?.[lang] ?? t("次四半期の会社見通し", "COMPANY OUTLOOK")}</span><ul>{verified.outlook.map((item) => <li key={item.en}>{item[lang]}</li>)}</ul></article><article><span>{t("この資料だけでは分からないこと", "NOT ESTABLISHED")}</span><p>{verified.unknown[lang]}</p></article></div>
          <footer><span>{t("照合日", "Reviewed")}: {verified.reviewedOn}</span><span><a href={verified.source.url} target="_blank" rel="noreferrer">{t("公式原文 ↗", "Official source ↗")}</a>{verified.additionalSources?.map((source, index) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{t(`比較元${index + 1} ↗`, `Comparison source ${index + 1} ↗`)}</a>)}</span></footer>
        </div> : <div className={styles.pipeline}>
          <article className={discoveryAvailable ? styles.complete : ""}><span>01</span><h3>{t("公式発表を検知", "Detect release")}</h3><strong>{discoveryLabel}</strong><p>{company.discovery.status === "fallback" ? t(`企業サイトの直接取得が不安定なため、SEC提出書類から${company.discovery.candidates}件を検出しました。`, `The company site was unavailable to automation; ${company.discovery.candidates} SEC filing links were found.`) : company.discovery.status === "ok" ? t(`${company.discovery.candidates}件のリンクを検出しました。`, `${company.discovery.candidates} links were found.`) : error || t("取得記録がありません。", "No retrieval record.")}</p><small>{t("最終確認", "Last check")}: {time(company.discovery.checkedAt, lang)} JST</small></article>
          <article className={company.counts.fetched > 0 ? styles.complete : ""}><span>02</span><h3>{t("原文を取得", "Fetch source")}</h3><strong>{company.counts.fetched > 0 ? t(`${company.counts.fetched}件取得`, `${company.counts.fetched} fetched`) : t("取得待ち", "Awaiting fetch")}</strong><p>{t("取得できても、発表日・数値・対象期間の照合が必要です。", "Publication date, values, and reporting period still require review.")}</p></article>
          <article><span>03</span><h3>{t("前回と比較", "Compare changes")}</h3><strong>{t("編集確認待ち", "Awaiting editorial review")}</strong><p>{t("同じ定義の数値をそろえ、事実・影響・未確認事項を分けて公開します。", "Comparable metrics must be aligned before facts, impact, and unknowns are published separately.")}</p></article>
        </div>}
      </section>

      <section className={styles.section} aria-labelledby="sources-title"><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>02 / OFFICIAL RELEASES</p><h2 id="sources-title">{t("検知した公式資料", "Detected official sources")}</h2></div><a href={company.indexUrl} target="_blank" rel="noreferrer">{t(`公式${company.format === "rss" ? "RSS" : "一覧"} ↗`, `Official ${company.format === "rss" ? "RSS" : "release list"} ↗`)}</a></div>
        <details className={styles.intakeDetails}>
          <summary>{t("資料の取得状況", "Source intake status")} <span>{t(`登録${company.counts.total}件・本文取得${company.counts.fetched}件`, `${company.counts.total} found · ${company.counts.fetched} fetched`)}</span></summary>
          <div className={styles.stats}>
            <div><span>{t("登録資料", "Sources found")}</span><strong>{company.counts.total}</strong><small>{t("過去分を含む", "Includes historical items")}</small></div>
            <div><span>{t("本文を取得", "Bodies fetched")}</span><strong>{company.counts.fetched}</strong><small>{t("内容の照合前", "Not yet reviewed")}</small></div>
            <div><span>{t("未取得", "Not fetched")}</span><strong>{company.counts.unfetched}</strong><small>{t("順次確認", "Awaiting checks")}</small></div>
            <div><span>{t("取得エラー", "Fetch errors")}</span><strong>{company.counts.error}</strong><small>{t("経路の調整対象", "Retrieval path to review")}</small></div>
          </div>
        </details>
        {company.sources.length ? <ol className={styles.sources}>{company.sources.slice(0, 12).map((source) => <li key={source.url}><article><div className={styles.sourceTop}><span className={source.fetchState === "fetched" ? styles.fetched : source.fetchState === "error" ? styles.failed : styles.pending}>{source.fetchState === "fetched" ? t("本文取得済み", "Fetched") : source.fetchState === "error" ? t("取得エラー", "Fetch error") : t("本文未取得", "Not fetched")}</span><time>{source.published_on ?? t("発表日未確認", "Publication date unverified")}</time></div><h3>{source.displayTitle}</h3><p>{new URL(source.url).hostname}</p><div><span>{t("初回検知", "First detected")}: {time(source.discovered_at, lang)} JST</span><a href={source.url} target="_blank" rel="noreferrer">{t("公式原文 ↗", "Official source ↗")}</a></div></article></li>)}</ol> : <div className={styles.empty}><h3>{t("資料リンクをまだ登録できていません", "No source links registered yet")}</h3><p>{error || t("公式一覧の取得方法を確認しています。", "The official release-list method is being reviewed.")}</p><a href={company.indexUrl} target="_blank" rel="noreferrer">{t("公式サイトを確認 ↗", "Open official site ↗")}</a></div>}
        {company.sources.length > 12 && <p className={styles.more}><Link href="/research/intake">{t(`残り${company.sources.length - 12}件を取得状況画面で確認 →`, `View ${company.sources.length - 12} more in intake status →`)}</Link></p>}
      </section>

      <section className={styles.section} aria-labelledby="next-title"><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>03 / NEXT REVIEW</p><h2 id="next-title">{t("この銘柄で次に確認すること", "Next checks for this company")}</h2></div></div><div className={styles.nextChecks}>
        <article><span>1</span><h3>{t("発表日と資料の種類", "Date and source type")}</h3><p>{t("決算・提携・製品発表を分け、公開日時を公式原文で確定します。", "Classify earnings, partnerships, and product releases; verify publication time in the original source.")}</p></article>
        <article><span>2</span><h3>{t("比較できる数値", "Comparable metrics")}</h3><p>{t("前回と同じ対象・期間・会計基準の数値だけを並べます。", "Only values with matching scope, period, and accounting basis are compared.")}</p></article>
        <article><span>3</span><h3>{t("影響と未確認事項", "Impact and unknowns")}</h3><p>{t("発表された事実と、業績・関連銘柄への解釈を分けて記録します。", "Published facts are kept separate from interpretations about financial and related-stock impact.")}</p></article>
      </div></section>
      <footer className={styles.footer}>TECH PHASE RESEARCH<p>{t("このページは取得状況の確認版です。リアルタイム配信や分析完了を示すものではありません。", "This page shows intake progress. It does not indicate real-time delivery or completed analysis.")}</p></footer>
    </main>
  </div>;
}
