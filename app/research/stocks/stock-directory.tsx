"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AnnualFilingBrief } from "@/lib/research/annual-filing-briefs";
import type { BusinessSection, RiskSection, StockDirectoryEntry, StockProfile } from "@/lib/research/stock-directory";
import { useResearchLanguage } from "../use-research-language";
import base from "../research.module.css";
import styles from "./stocks.module.css";
import polish from "./stock-polish.module.css";
import filingStyles from "./filings.module.css";
import { MarketWorkspace } from "./market-workspace";

type SearchResponse = { ok: boolean; results?: StockDirectoryEntry[]; error?: string; source?: string; asOf?: string };
type ProfileResponse = { ok: boolean; profile?: StockProfile; error?: string; profileSource?: string; asOf?: string };
type BusinessResponse = { ok: boolean; business?: BusinessSection | null; risks?: RiskSection | null; brief?: AnnualFilingBrief | null; briefStatus?: "approved" | "pending"; error?: string };
type BriefStatus = "idle" | "loading" | "approved" | "pending" | "source-unavailable";

function exchangeLabel(exchange: string) {
  return exchange === "Nasdaq" ? "NASDAQ" : exchange.toUpperCase();
}

function filingLabel(form: string, lang: "ja" | "en") {
  const base = form.replace("/A", "");
  const labels: Record<string, [string, string]> = {
    "10-K": ["年次報告書", "Annual report"],
    "10-Q": ["四半期報告書", "Quarterly report"],
    "8-K": ["重要事項報告", "Current report"],
    "6-K": ["外国企業の重要報告", "Foreign issuer report"],
    "20-F": ["外国企業の年次報告", "Foreign issuer annual report"],
    "40-F": ["カナダ企業の年次報告", "Canadian issuer annual report"],
  };
  const label = labels[base]?.[lang === "ja" ? 0 : 1] ?? (lang === "ja" ? "SEC提出書類" : "SEC filing");
  return form.endsWith("/A") ? `${label}${lang === "ja" ? "（訂正）" : " (amended)"}` : label;
}

export default function StockDirectory() {
  const [lang, setLang] = useResearchLanguage();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockDirectoryEntry[]>([]);
  const [selectedResultKey, setSelectedResultKey] = useState<string | null>(null);
  const [profile, setProfile] = useState<StockProfile | null>(null);
  const [business, setBusiness] = useState<BusinessSection | null>(null);
  const [risks, setRisks] = useState<RiskSection | null>(null);
  const [brief, setBrief] = useState<AnnualFilingBrief | null>(null);
  const [briefStatus, setBriefStatus] = useState<BriefStatus>("idle");
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [businessLoading, setBusinessLoading] = useState(false);
  const [businessUnavailable, setBusinessUnavailable] = useState(false);
  const [risksUnavailable, setRisksUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const searchRequest = useRef(0);
  const profileRequest = useRef(0);
  const businessRequest = useRef(0);
  const marketTarget = useRef<HTMLDivElement>(null);
  const marketTicker = profile?.ticker ?? null;
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;

  useEffect(() => {
    if (!selectedResultKey || (!profileLoading && !marketTicker)) return;
    const frame = window.requestAnimationFrame(() => {
      marketTarget.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [marketTicker, profileLoading, selectedResultKey]);

  useEffect(() => {
    const q = query.trim();
    const requestId = ++searchRequest.current;
    profileRequest.current += 1;
    businessRequest.current += 1;
    setProfile(null);
    setSelectedResultKey(null);
    setBusiness(null);
    setRisks(null);
    setBrief(null);
    setBriefStatus("idle");
    setBusinessLoading(false);
    setBusinessUnavailable(false);
    setRisksUnavailable(false);
    setError(null);
    if (!q) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/research/stocks?q=${encodeURIComponent(q)}&limit=24`, { signal: controller.signal });
        const data = await response.json() as SearchResponse;
        if (requestId !== searchRequest.current) return;
        if (!response.ok || !data.ok) throw new Error(data.error || "search-failed");
        const nextResults = data.results ?? [];
        setResults(nextResults);
        setAsOf(data.asOf ?? null);
      } catch (reason) {
        if (controller.signal.aborted || requestId !== searchRequest.current) return;
        setResults([]);
        setError(reason instanceof Error ? reason.message : "search-failed");
      } finally {
        if (requestId === searchRequest.current) setLoading(false);
      }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  async function selectStock(entry: StockDirectoryEntry) {
    setSelectedResultKey(`${entry.ticker}:${entry.cik}:${entry.exchange}`);
    const requestId = ++profileRequest.current;
    businessRequest.current += 1;
    setProfileLoading(true);
    setBusiness(null);
    setRisks(null);
    setBrief(null);
    setBriefStatus("idle");
    setBusinessLoading(false);
    setBusinessUnavailable(false);
    setRisksUnavailable(false);
    setError(null);
    try {
      const response = await fetch(`/api/research/stocks?ticker=${encodeURIComponent(entry.ticker)}`);
      const data = await response.json() as ProfileResponse;
      if (requestId !== profileRequest.current) return;
      if (!response.ok || !data.ok || !data.profile) throw new Error(data.error || "profile-failed");
      setProfile(data.profile);
      setAsOf(data.asOf ?? asOf);
      if (data.profile.latestAnnualFiling) void loadBusiness(entry.ticker);
    } catch (reason) {
      if (requestId !== profileRequest.current) return;
      setError(reason instanceof Error ? reason.message : "profile-failed");
    } finally {
      if (requestId === profileRequest.current) setProfileLoading(false);
    }
  }

  async function loadBusiness(ticker: string) {
    const requestId = ++businessRequest.current;
    setBusinessLoading(true);
    setBriefStatus("loading");
    setBusinessUnavailable(false);
    setRisksUnavailable(false);
    try {
      const response = await fetch(`/api/research/stocks?ticker=${encodeURIComponent(ticker)}&view=business`);
      const data = await response.json() as BusinessResponse;
      if (requestId !== businessRequest.current) return;
      if (!response.ok || !data.ok) {
        if (response.status === 404 || response.status === 422) { setBusinessUnavailable(true); setRisksUnavailable(true); setBriefStatus("source-unavailable"); return; }
        throw new Error(data.error || "business-section-failed");
      }
      setBusiness(data.business ?? null);
      setBusinessUnavailable(!data.business);
      setRisks(data.risks ?? null);
      setRisksUnavailable(!data.risks);
      setBrief(data.brief ?? null);
      setBriefStatus(data.briefStatus === "approved" && data.brief ? "approved" : "pending");
    } catch {
      if (requestId === businessRequest.current) {
        setBusinessUnavailable(true);
        setRisksUnavailable(true);
        setBriefStatus("source-unavailable");
      }
    } finally {
      if (requestId === businessRequest.current) setBusinessLoading(false);
    }
  }

  const errorMessage = error ? t("現在、SECの公式名簿を取得できません。監視対象22銘柄の速報機能には影響しません。", "The official SEC directory is temporarily unavailable. The 22-company monitoring pipeline is unaffected.") : null;
  const visibleResults = selectedResultKey
    ? results.filter((entry) => `${entry.ticker}:${entry.cik}:${entry.exchange}` === selectedResultKey)
    : results;

  return <div className={base.app} lang={lang}>
    <a className={base.skip} href="#stock-search-main">{t("本文へ移動", "Skip to content")}</a>
    <header className={base.header}>
      <Link href="/research" className={base.brand} aria-label="Tech Phase Research"><span className={base.mark}>TP<span /></span><span>TECH PHASE<small>RESEARCH</small></span></Link>
      <nav className={base.primaryNav} aria-label={t("メインメニュー", "Main navigation")}><Link href="/research">{t("ホーム", "Home")}</Link><Link href="/research#what-changed">{t("何が変わった？", "What changed?")}</Link><Link href="/research/stocks" aria-current="page">{t("米国株を探す", "Find stocks")}</Link><Link href="/research#metrics">{t("決算・指標", "Financials")}</Link><Link className={base.proNav} href="/research#tech-phase-pro">Tech Phase PRO</Link></nav>
      <div className={base.headerRight}><span className={base.edition}>US STOCK DIRECTORY <span>PREVIEW</span></span><div className={base.languages} aria-label={t("言語", "Language")}><button onClick={() => setLang("ja")} aria-pressed={lang === "ja"}>日本語</button><button onClick={() => setLang("en")} aria-pressed={lang === "en"}>EN</button></div></div>
    </header>
    <main id="stock-search-main" className={styles.main}>
      <div className={styles.topline}><Link href="/research">← {t("リサーチ画面", "Research desk")}</Link><span>{t("SEC公式データ使用", "Powered by official SEC data")}</span></div>
      <section className={styles.hero}>
        <p>STOCK DISCOVERY</p>
        <h1><span className={polish.desktopTitle}>{t("米国株を、すぐ調べる。", "Find a U.S. stock in seconds.")}</span><span className={polish.mobileTitle}>{t("米国株リサーチ", "U.S. stock research")}</span></h1>
        <p>{t("ティッカーまたは企業名で検索。会社名、取引所、SEC識別番号、業種を一次情報から確認できます。", "Search by ticker or company name. Verify the company, exchange, SEC identifier, and industry from primary data.")}</p>
        <label className={styles.search}><span aria-hidden="true">⌕</span><input autoComplete="off" inputMode="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("例：NVDA、Micron、Palantir", "Try NVDA, Micron, or Palantir")} aria-label={t("米国株を検索", "Search U.S. stocks")} /><kbd>SEC</kbd></label>
        <div className={styles.scope}><span>{t("無料の企業名簿", "Free company directory")}</span><span>{t("TradingView株価・12か月チャート", "TradingView quote and 12-month chart")}</span><span>{t("ニュース権利と分離", "Separate from news licensing")}</span></div>
      </section>

      <div className={`${styles.layout} ${polish.resultLayout}`}>
        <section className={styles.results} aria-labelledby="results-title" aria-busy={loading}>
          <div className={styles.sectionHeading}><div><p>SEARCH RESULTS</p><h2 id="results-title">{query.trim() ? t("検索結果", "Matches") : t("銘柄名かティッカーを入力", "Enter a company or ticker")}</h2></div><span aria-live="polite">{loading ? t("検索中…", "Searching…") : query.trim() ? `${results.length}${t("件", " results")}` : "—"}</span></div>
          {errorMessage && <div className={styles.error} role="alert"><strong>{t("取得経路を確認中", "Source unavailable")}</strong><p>{errorMessage}</p></div>}
          {!error && query.trim() && !loading && results.length === 0 && <div className={styles.empty}><strong>{t("該当銘柄が見つかりません", "No matching ticker")}</strong><p>{t("英語の企業名またはティッカーで検索してください。SEC名簿は全銘柄を保証するものではありません。", "Try an English company name or ticker. The SEC does not guarantee complete coverage.")}</p></div>}
          {!query.trim() && <div className={styles.examples}><button onClick={() => setQuery("NVDA")}>NVDA</button><button onClick={() => setQuery("Micron")}>Micron</button><button onClick={() => setQuery("Nebius")}>Nebius</button><button onClick={() => setQuery("Palantir")}>Palantir</button><button onClick={() => setQuery("Vertiv")}>Vertiv</button></div>}
          {results.length > 0 && <div className={polish.resultGuide}><p className={polish.resultHint}>{selectedResultKey ? t("選択した銘柄を表示しています。", "Showing the selected stock.") : t("銘柄を選ぶと株価と公式情報を表示します。", "Choose a stock to view prices and official information.")}</p>{selectedResultKey && results.length > 1 && <button type="button" onClick={() => setSelectedResultKey(null)}>{t("ほかの検索結果を見る", "Show other matches")}</button>}</div>}
          <ol className={styles.resultList}>{visibleResults.map((entry) => <li key={`${entry.ticker}:${entry.cik}:${entry.exchange}`}><button className={polish.resultButton} onClick={() => selectStock(entry)} aria-current={selectedResultKey === `${entry.ticker}:${entry.cik}:${entry.exchange}` ? "true" : undefined}><span className={styles.ticker}>{entry.ticker}</span><span className={styles.identity}><strong>{entry.name}</strong><small>CIK {String(entry.cik).padStart(10, "0")}</small></span><span className={styles.exchange}>{exchangeLabel(entry.exchange)}{entry.tracked && <em>{t("監視中", "WATCHED")}</em>}</span><span className={polish.resultCta}>{selectedResultKey === `${entry.ticker}:${entry.cik}:${entry.exchange}` ? t("表示中", "OPEN") : t("詳細を見る", "VIEW")} <span aria-hidden="true">→</span></span></button></li>)}</ol>
          {asOf && <p className={styles.asOf}>{t("表示取得時刻", "Retrieved")}: <time dateTime={asOf}>{new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(new Date(asOf))} JST</time></p>}
        </section>

      </div>

      {(profileLoading || profile) && <div ref={marketTarget} className={polish.marketTarget}>
        {profileLoading && <div className={polish.profileLoading} role="status"><span className={styles.loader} /><strong>{t("株価とSEC企業情報を確認中", "Loading price and SEC company data")}</strong></div>}
        {profile && <MarketWorkspace key={`${profile.exchange}:${profile.ticker}:${lang}`} ticker={profile.ticker} exchange={profile.exchange} name={profile.name} lang={lang} />}
      </div>}

      {profile && <details className={polish.profileDetails}>
        <summary><span><small>SEC COMPANY RECORD</small><strong>{t("企業登録情報", "Company registration data")}</strong></span><em>{t("業種・法人区分などを表示", "Industry, entity type, and more")}</em></summary>
        <div className={polish.profileBody}>
          <div className={styles.profileTop}><span>{exchangeLabel(profile.exchange)} · {profile.ticker} · {profile.name}</span>{profile.tracked && <em>{t("公式発表を自動監視中", "Official releases monitored")}</em>}</div>
          <dl><div><dt>{t("SEC業種", "SEC industry")}</dt><dd>{profile.sicDescription ?? t("未掲載", "Not listed")}{profile.sic && <small>SIC {profile.sic}</small>}</dd></div><div><dt>{t("法人区分", "Entity type")}</dt><dd>{profile.entityType ?? t("未掲載", "Not listed")}</dd></div><div><dt>{t("設立・登録地域", "Incorporation")}</dt><dd>{profile.stateOfIncorporation ?? t("未掲載", "Not listed")}</dd></div><div><dt>{t("決算期末", "Fiscal year end")}</dt><dd>{profile.fiscalYearEnd ?? t("未掲載", "Not listed")}</dd></div></dl>
          <div className={styles.actions}><a href={profile.secProfileUrl} target="_blank" rel="noreferrer">{t("SEC提出書類を見る ↗", "Open SEC filings ↗")}</a>{profile.tracked && <Link href={`/research/companies/${profile.ticker}`}>{t("Tech Phase銘柄ページ →", "Tech Phase company page →")}</Link>}</div>
          <p className={styles.profileNote}>{t("業種・法人区分はSEC登録情報です。Tech Phase独自分類や投資判断ではありません。", "Industry and entity type come from SEC registration records, not a Tech Phase rating.")}</p>
        </div>
      </details>}

      {profile?.latestAnnualFiling && <section className={filingStyles.brief} aria-labelledby="annual-brief-title" aria-busy={briefStatus === "loading"}>
        <div className={styles.sectionHeading}><div><p>REVIEWED JAPANESE BRIEF</p><h2 id="annual-brief-title">{t("根拠付き日本語要点", "Evidence-backed Japanese brief")}</h2></div><span className={briefStatus === "approved" ? filingStyles.briefApproved : filingStyles.briefPending}>{briefStatus === "approved" ? t("人間確認済み", "Human reviewed") : briefStatus === "loading" ? t("原文照合中", "Checking source") : briefStatus === "source-unavailable" ? t("原文確認不可", "Source unavailable") : t("編集確認待ち", "Awaiting review")}</span></div>
        {briefStatus === "approved" && brief ? <>
          <div className={filingStyles.briefSummary}><span>{t("要点", "Summary")}</span><p>{brief.summaryJa}</p></div>
          <div className={filingStyles.briefGrid}><article><span>{t("何で稼ぐ会社か", "Business model")}</span><p>{brief.businessModelJa}</p></article><article><span>{t("重要リスク", "Key risks")}</span><ol>{brief.riskPointsJa.map((point, index) => <li key={`${point.text}-${index}`}>{point.text}</li>)}</ol></article></div>
          <details className={filingStyles.briefEvidence}><summary>{t("根拠引用を確認", "Review source evidence")}</summary><ol>{brief.evidence.map((item) => <li key={item.id}><span>{item.section === "business" ? t("事業説明", "Business") : t("リスク", "Risk")}</span><q>{item.quote}</q></li>)}</ol></details>
          <div className={filingStyles.briefMeta}><span>{t("確信度", "Confidence")}: {brief.confidence}</span><span>{t("確認日時", "Reviewed")}: <time dateTime={brief.reviewedAt}>{new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(new Date(brief.reviewedAt))} JST</time></span><span>{t("生成方法", "Method")}: {brief.generationMethod === "ai-assisted" ? t("AI補助＋人間確認", "AI-assisted + human review") : t("人間作成", "Human-authored")}</span><span>SHA {brief.sourceSha256.slice(0, 12)}</span></div>
        </> : briefStatus === "loading" ? <div className={filingStyles.businessStatus}><span className={styles.loader} /><strong>{t("年次報告書と日本語要点を照合中", "Checking the annual filing against reviewed copy")}</strong></div> : <div className={filingStyles.briefGate}><strong>{briefStatus === "source-unavailable" ? t("原文を確認できないため日本語要点を停止しました", "Japanese copy is withheld because the source could not be verified") : t("日本語要点は編集確認待ちです", "The Japanese brief is awaiting editorial review")}</strong><p>{t("提出番号・原文SHA・根拠引用・数値を照合し、人間が承認した版だけを表示します。原文が更新された場合、以前の承認は自動的に無効になります。", "Only a human-approved version with matching accession, source SHA, evidence quotes, and numbers is shown. A source update automatically invalidates the prior approval.")}</p></div>}
      </section>}

      {profile && <section className={filingStyles.sourceArchive} aria-labelledby="source-archive-title">
        <div><p>PRIMARY SOURCE ARCHIVE</p><h2 id="source-archive-title">{t("SEC英語原文", "SEC source documents")}</h2><p>{t("長い英語原文は証拠資料として収納しました。必要な部分だけ開いて確認できます。", "Long English excerpts are stored as supporting evidence. Open only the source section you need.")}</p></div>
        <span>{t("必要なときだけ開く", "Open when needed")}</span>
      </section>}

      {profile && <details className={`${filingStyles.sourceDetails} ${filingStyles.businessSource}`} aria-labelledby="business-section-title">
        <summary><span className={filingStyles.sourceNumber}>01</span><span className={filingStyles.sourceTitle}><small>OFFICIAL BUSINESS DESCRIPTION</small><strong id="business-section-title">{t("どんな企業か — 年次報告書の原文", "What the company does — annual filing source")}</strong></span><span className={filingStyles.sourceMeta}>{businessLoading ? t("確認中", "Loading") : business ? `${business.form} · ${business.filingDate}` : t("原文なし", "Unavailable")}</span></summary>
        <div className={filingStyles.sourceBody} aria-busy={businessLoading}>
        {businessLoading ? <div className={filingStyles.businessStatus}><span className={styles.loader} /><strong>{t("SEC年次報告書の事業説明を確認中", "Extracting the business section from the SEC annual filing")}</strong></div> : business ? <>
          <div className={filingStyles.evidenceBar}><span>{t("一次情報から機械抽出", "Machine-extracted from primary source")}</span><span>{business.extractionMethod === "cross-referenced-overview" ? t("20-F参照先を検証", "Verified 20-F cross-reference") : t("様式見出しを検証", "Verified form heading")}</span><span>{business.heading}</span><span>{t("原文照合用SHA", "Source SHA")} {business.sourceSha256.slice(0, 12)}</span></div>
          <blockquote className={filingStyles.businessExcerpt}>{business.excerpt}</blockquote>
          <dl className={filingStyles.businessMeta}><div><dt>{t("書類", "Form")}</dt><dd>{business.form}</dd></div><div><dt>{t("提出日", "Filed")}</dt><dd>{business.filingDate}</dd></div>{business.reportDate && <div><dt>{t("対象期末", "Period end")}</dt><dd>{business.reportDate}</dd></div>}<div><dt>{t("取得時刻", "Retrieved")}</dt><dd><time dateTime={business.retrievedAt}>{new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(new Date(business.retrievedAt))} JST</time></dd></div><div><dt>{t("抽出範囲", "Extracted section")}</dt><dd>{business.sectionCharacters.toLocaleString(lang === "ja" ? "ja-JP" : "en-US")}{t("文字", " characters")}{business.truncated ? t("（表示は冒頭のみ）", " (opening excerpt shown)") : ""}</dd></div></dl>
          <div className={filingStyles.businessActions}><a href={business.documentUrl} target="_blank" rel="noreferrer">{t("SEC原文で続きを確認 ↗", "Continue in the SEC filing ↗")}</a><a href={business.filingIndexUrl} target="_blank" rel="noreferrer">{t("添付資料一覧 ↗", "Filing index ↗")}</a></div>
          <p className={filingStyles.businessNote}>{business.extractionMethod === "cross-referenced-overview" ? t("この20-FはItem 4から年次報告書内の企業概要を参照しています。参照表ではなく、参照先で確認できた企業提出原文だけを表示しています。日本語要約・評価ではありません。", "This 20-F points from Item 4 to a company overview elsewhere in the annual report. Only the verified referenced source text is shown, not the cross-reference table. This is not a Tech Phase summary or rating.") : t("これは企業自身が提出した英語原文の抜粋です。Tech Phaseによる日本語要約・評価ではありません。見出し構造を判定できない書類は推測せず表示を止めます。", "This is an English excerpt filed by the company, not a Tech Phase summary or rating. If the filing structure cannot be verified, the excerpt is withheld rather than guessed.")}</p>
        </> : <div className={filingStyles.businessStatus}><strong>{businessUnavailable ? t("事業説明を安全に抽出できませんでした", "A business section could not be safely extracted") : t("対象の10-K／20-Fが見つかりません", "No eligible 10-K or 20-F was found")}</strong><p>{t("SEC原文へのリンクは下の提出書類一覧から確認できます。企業概要を推測で補完しません。", "The original filing remains available below. Tech Phase does not fill this gap with an inferred company description.")}</p></div>}
        </div>
      </details>}

      {profile && <details className={`${filingStyles.sourceDetails} ${filingStyles.riskSource}`} aria-labelledby="risk-section-title">
        <summary><span className={filingStyles.sourceNumber}>02</span><span className={filingStyles.sourceTitle}><small>OFFICIAL RISK FACTORS</small><strong id="risk-section-title">{t("主要リスク — 年次報告書の原文", "Key risks — annual filing source")}</strong></span><span className={filingStyles.sourceMeta}>{businessLoading ? t("確認中", "Loading") : risks ? `${risks.form} · ${risks.filingDate}` : t("原文なし", "Unavailable")}</span></summary>
        <div className={filingStyles.sourceBody} aria-busy={businessLoading}>
        {businessLoading ? <div className={filingStyles.businessStatus}><span className={styles.loader} /><strong>{t("SEC年次報告書のリスク項目を確認中", "Extracting risk factors from the SEC annual filing")}</strong></div> : risks ? <>
          <div className={filingStyles.riskEvidenceBar}><span>{t("一次情報から機械抽出", "Machine-extracted from primary source")}</span><span>{risks.extractionMethod === "cross-referenced-risk-factors" ? t("20-Fリスク参照先を検証", "Verified 20-F risk cross-reference") : t("リスク見出しを検証", "Verified risk heading")}</span><span>{risks.heading}</span><span>{t("原文照合用SHA", "Source SHA")} {risks.sourceSha256.slice(0, 12)}</span></div>
          {risks.overview && <div className={filingStyles.riskOverview}>
            <div className={filingStyles.riskOverviewHeading}><div><span>{t("企業自身の要約", "Issuer summary")}</span><strong>{t("リスク早見表（英語原文）", "Risk overview (original English)")}</strong></div><b>{risks.overview.itemCount}{t("項目", " items")}</b></div>
            <p>{t("企業が年次報告書で要約・一覧として明示した項目だけを、記載順のまま表示します。Tech Phaseによる選別・順位付け・翻訳ではありません。", "Only items explicitly listed by the issuer as a summary or overview are shown, in filing order. This is not Tech Phase selection, ranking, or translation.")}</p>
            <div className={filingStyles.riskGroups}>{risks.overview.groups.map((group, groupIndex) => <section key={`${group.heading ?? "ungrouped"}-${groupIndex}`}>
              {group.heading && <h3>{group.heading}</h3>}
              <ol>{group.items.map((item, itemIndex) => <li key={`${item.slice(0, 72)}-${itemIndex}`}>{item}</li>)}</ol>
            </section>)}</div>
            <small>{risks.overview.heading} · {risks.overview.extractionMethod === "issuer-risk-summary" ? t("明示された要約見出しを検証", "Verified explicit summary heading") : t("明示された一覧見出しを検証", "Verified explicit overview heading")}</small>
          </div>}
          <blockquote className={filingStyles.riskExcerpt}>{risks.excerpt}</blockquote>
          <dl className={filingStyles.businessMeta}><div><dt>{t("書類", "Form")}</dt><dd>{risks.form}</dd></div><div><dt>{t("提出日", "Filed")}</dt><dd>{risks.filingDate}</dd></div>{risks.reportDate && <div><dt>{t("対象期末", "Period end")}</dt><dd>{risks.reportDate}</dd></div>}<div><dt>{t("取得時刻", "Retrieved")}</dt><dd><time dateTime={risks.retrievedAt}>{new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(new Date(risks.retrievedAt))} JST</time></dd></div><div><dt>{t("抽出範囲", "Extracted section")}</dt><dd>{risks.sectionCharacters.toLocaleString(lang === "ja" ? "ja-JP" : "en-US")}{t("文字", " characters")}{risks.truncated ? t("（表示は冒頭のみ）", " (opening excerpt shown)") : ""}</dd></div></dl>
          <div className={filingStyles.businessActions}><a href={risks.documentUrl} target="_blank" rel="noreferrer">{t("SEC原文で続きを確認 ↗", "Continue in the SEC filing ↗")}</a><a href={risks.filingIndexUrl} target="_blank" rel="noreferrer">{t("添付資料一覧 ↗", "Filing index ↗")}</a></div>
          <p className={filingStyles.businessNote}>{risks.extractionMethod === "cross-referenced-risk-factors" ? t("この20-FはItem 3.Dから年次報告書内のリスク項目を参照しています。参照表ではなく、参照先で確認できた企業提出原文だけを表示しています。", "This 20-F points from Item 3.D to risk factors elsewhere in the annual report. Only the verified referenced source text is shown, not the cross-reference table.") : t("企業自身が提出したリスク項目の英語原文です。重要度順の並べ替えやTech Phaseによる投資判断ではありません。構造を検証できない書類は表示しません。", "This is the issuer-filed English risk section, not a Tech Phase ranking or investment judgment. The section is withheld when its filing structure cannot be verified.")}</p>
        </> : <div className={filingStyles.businessStatus}><strong>{risksUnavailable ? t("リスク項目を安全に抽出できませんでした", "Risk factors could not be safely extracted") : t("対象の年次報告書が見つかりません", "No eligible annual filing was found")}</strong><p>{t("SEC原文へのリンクは提出書類一覧から確認できます。リスクを推測で補完しません。", "The original filing remains available in the filing list. Tech Phase does not infer missing risk factors.")}</p></div>}
        </div>
      </details>}

      {profile && <section className={filingStyles.filings} aria-labelledby="recent-filings-title">
        <div className={styles.sectionHeading}><div><p>RECENT SEC FILINGS</p><h2 id="recent-filings-title">{t("最新の重要提出書類", "Recent material filings")}</h2></div><span>{profile.recentFilings.length}{t("件", " filings")}</span></div>
        <p className={filingStyles.filingIntro}>{t("SEC提出履歴から年次・四半期報告と重要事項を抽出しています。提出日は発表日や決算日と同じとは限りません。", "Filtered from SEC submission history for annual, quarterly, and material current reports. Filing date is not necessarily the announcement or earnings date.")}</p>
        {profile.recentFilings.length ? <ol className={filingStyles.filingList}>{profile.recentFilings.map((filing) => <li key={filing.accessionNumber}>
          <div><span>{filing.form}</span><strong>{filingLabel(filing.form, lang)}</strong></div>
          <dl><div><dt>{t("提出日", "Filed")}</dt><dd><time dateTime={filing.filingDate}>{filing.filingDate}</time></dd></div>{filing.reportDate && <div><dt>{t("対象期末", "Period end")}</dt><dd><time dateTime={filing.reportDate}>{filing.reportDate}</time></dd></div>}{filing.items && <div><dt>{t("8-K項目", "8-K items")}</dt><dd>{filing.items}</dd></div>}</dl>
          <div className={filingStyles.filingActions}><a href={filing.documentUrl} target="_blank" rel="noreferrer">{t("原文を開く ↗", "Open filing ↗")}</a><a href={filing.filingIndexUrl} target="_blank" rel="noreferrer">{t("添付資料一覧 ↗", "Filing index ↗")}</a></div>
        </li>)}</ol> : <div className={styles.empty}><strong>{t("対象書類が見つかりません", "No material filings found")}</strong><p>{t("直近のSEC提出履歴に対象形式がないか、企業が別の開示制度を利用している可能性があります。", "The recent SEC history may not contain these form types, or the issuer may use another disclosure regime.")}</p></div>}
        <p className={filingStyles.filingNote}>{t("SEC公式APIを1時間キャッシュして表示します。リアルタイム通知ではありません。", "Shown from the official SEC API with a one-hour source cache. This is not a real-time alert feed.")}</p>
      </section>}

      <section className={styles.disclosure}><div><span>01</span><h2>{t("何が無料で使える？", "What is free?")}</h2><p>{t("SECの企業名簿・提出書類と、TradingViewの参考株価・12か月チャートを確認できます。", "View the SEC company directory and filings alongside a TradingView reference quote and 12-month chart.")}</p></div><div><span>02</span><h2>{t("まだ何を出さない？", "What is not shown yet?")}</h2><p>{t("契約未確認のリアルタイム株価、時間外価格、通信社ニュース。表示権を確認するまで数値を出しません。", "Unlicensed real-time prices, extended-hours quotes, and wire-service news. Values remain withheld until display rights are confirmed.")}</p></div><div><span>03</span><h2>{t("次に何を追加する？", "What comes next?")}</h2><p>{t("承認済みの配信元を独自画面へ接続し、無料版は企業調査、PROは速報・変化追跡として明確に分けます。", "Connect an approved provider to the custom view, keeping company research in Free and timely change tracking in PRO.")}</p></div></section>
      <footer className={styles.footer}><span>TECH PHASE RESEARCH</span><p>{t("SECは名簿の正確性・網羅性を保証していません。検索結果は企業識別用で、売買推奨ではありません。", "The SEC does not guarantee directory accuracy or scope. Results identify issuers and are not investment recommendations.")}</p></footer>
    </main>
  </div>;
}
