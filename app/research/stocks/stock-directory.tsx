"use client";

import Link from "next/link";
import MembershipLabel from "../membership-label";
import HeaderPro from "../header-pro";
import HomeLink from "../home-link";
import NavigationIcon from "../navigation-icon";
import { useSearchParams } from "next/navigation";
import { useStockFavorites } from "../use-stock-favorites";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { AnnualFilingBrief } from "@/lib/research/annual-filing-briefs";
import type { StockDirectoryEntry, StockProfile } from "@/lib/research/stock-directory";
import { useResearchLanguage } from "../use-research-language";
import base from "../research.module.css";
import styles from "./stocks.module.css";
import polish from "./stock-polish.module.css";
import filingStyles from "./filings.module.css";
import { MarketWorkspace } from "./market-workspace";
import StockThemeDiscovery from "./stock-theme-discovery";
import StockSearchHistory from "./stock-search-history";
import { useStockHistory } from "./use-stock-history";

type SearchResponse = { ok: boolean; results?: StockDirectoryEntry[]; error?: string; source?: string; asOf?: string };
type ProfileResponse = { ok: boolean; profile?: StockProfile; error?: string; profileSource?: string; asOf?: string };
type BusinessResponse = { ok: boolean; brief?: AnnualFilingBrief | null; briefStatus?: "approved" | "pending"; error?: string };
type BriefStatus = "idle" | "loading" | "approved" | "pending" | "source-unavailable";

function exchangeLabel(exchange: string) {
  return exchange === "Nasdaq" ? "NASDAQ" : exchange.toUpperCase();
}

function BriefEvidence({ brief, evidenceIds, lang, label, documentUrl }: { brief: AnnualFilingBrief; evidenceIds: string[]; lang: "ja" | "en"; label: string; documentUrl: string }) {
  const evidence = evidenceIds.map((id) => brief.evidence.find((item) => item.id === id)).filter((item) => item !== undefined);
  return <details className={filingStyles.pointEvidence}>
    <summary>{lang === "ja" ? "根拠の原文を見る" : "Show source evidence"}<span className={filingStyles.srOnly}> — {label}</span><small>{evidence.length}{lang === "ja" ? "件" : " quotes"}</small></summary>
    {evidence.map((item) => <blockquote key={item.id} lang="en">{item.quote}</blockquote>)}
    <a href={documentUrl} target="_blank" rel="noreferrer">{lang === "ja" ? "年次報告書を開く ↗" : "Open annual filing ↗"}</a>
  </details>;
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
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const { favorites, toggle: toggleFavorite, error: favoriteError } = useStockFavorites();
  const { history, remember, clear: clearHistory, error: historyError } = useStockHistory();
  const [results, setResults] = useState<StockDirectoryEntry[]>([]);
  const [selectedResultKey, setSelectedResultKey] = useState<string | null>(null);
  const [directQuote, setDirectQuote] = useState<{ticker:string; exchange:string; name:string} | null>(null);
  const [profile, setProfile] = useState<StockProfile | null>(null);
  const [brief, setBrief] = useState<AnnualFilingBrief | null>(null);
  const [briefStatus, setBriefStatus] = useState<BriefStatus>("idle");
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const themeSelection = useRef<string | null>(null);
  const searchRequest = useRef(0);
  const profileRequest = useRef(0);
  const businessRequest = useRef(0);
  const marketTarget = useRef<HTMLDivElement>(null);
  const marketTicker = profile?.ticker ?? directQuote?.ticker ?? null;
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;

  useEffect(() => {
    if (!selectedResultKey || (!profileLoading && !marketTicker)) return;
    const frame = window.requestAnimationFrame(() => {
      marketTarget.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [marketTicker, profileLoading, selectedResultKey]);

  const openThemeResult = useEffectEvent((entry: StockDirectoryEntry) => { void selectStock(entry); });

  useEffect(() => {
    const q = query.trim();
    const requestId = ++searchRequest.current;
    profileRequest.current += 1;
    businessRequest.current += 1;
    setProfile(null);
    setDirectQuote(null);
    setProfileLoading(false);
    setResults([]);
    setSelectedResultKey(null);

    setBrief(null);
    setBriefStatus("idle");

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
        if (themeSelection.current === q) {
          themeSelection.current = null;
          const exact = nextResults.find(entry => entry.ticker === q);
          if (exact) openThemeResult(exact);
          else if (q === "DRAM" || q === "GLDM") {
            const quote = q === "DRAM"
              ? {ticker:q,exchange:"CBOE",name:"Roundhill Memory ETF"}
              : {ticker:q,exchange:"AMEX",name:"SPDR Gold MiniShares ETF"};
            setDirectQuote(quote);
            setSelectedResultKey(`${quote.exchange}:${q}`);
          }
        }
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

    setBrief(null);
    setBriefStatus("idle");

    setError(null);
    try {
      const response = await fetch(`/api/research/stocks?ticker=${encodeURIComponent(entry.ticker)}`);
      const data = await response.json() as ProfileResponse;
      if (requestId !== profileRequest.current) return;
      if (!response.ok || !data.ok || !data.profile) throw new Error(data.error || "profile-failed");
      setProfile(data.profile);
      remember(data.profile.ticker);
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

    setBriefStatus("loading");

    try {
      const response = await fetch(`/api/research/stocks?ticker=${encodeURIComponent(ticker)}&view=business`);
      const data = await response.json() as BusinessResponse;
      if (requestId !== businessRequest.current) return;
      if (!response.ok || !data.ok) {
        if (response.status === 404 || response.status === 422) { setBriefStatus("source-unavailable"); return; }
        throw new Error(data.error || "business-section-failed");
      }

      setBrief(data.brief ?? null);
      setBriefStatus(data.briefStatus === "approved" && data.brief ? "approved" : "pending");
    } catch {
      if (requestId === businessRequest.current) {

        setBriefStatus("source-unavailable");
      }
    }
  }

  const errorMessage = error ? t("銘柄情報を取得できませんでした。少し待って再検索してください。", "Company data is unavailable. Please try again shortly.") : null;
  const visibleResults = selectedResultKey
    ? results.filter((entry) => `${entry.ticker}:${entry.cik}:${entry.exchange}` === selectedResultKey)
    : results;

  return <div className={base.app} lang={lang}>
    <a className={base.skip} href="#stock-search-main">{t("本文へ移動", "Skip to content")}</a>
    <header className={base.header}>
      <Link href="/research" className={base.brand} aria-label="Tech Phase Research"><span className={base.logoMark} aria-hidden="true" /><span>TECH PHASE<MembershipLabel /></span></Link>
      <nav className={base.primaryNav} aria-label={t("メインメニュー", "Main navigation")}><Link href="/research#what-changed"><NavigationIcon name="changes" />{t("何が変わった？", "What changed?")}</Link><Link href="/research/stocks" aria-current="page"><NavigationIcon name="search" />{t("米国株を探す", "Find stocks")}</Link><Link href="/research#metrics"><NavigationIcon name="metrics" />{t("決算・指標", "Financials")}</Link></nav>
      <div className={base.headerRight}><span className={base.edition}>US STOCK DIRECTORY <span>PREVIEW</span></span><HomeLink lang={lang} /><div className={base.languages} aria-label={t("言語", "Language")}><button onClick={() => setLang("ja")} aria-pressed={lang === "ja"}>日本語</button><button onClick={() => setLang("en")} aria-pressed={lang === "en"}>EN</button></div><HeaderPro /></div>
    </header>
    <main id="stock-search-main" className={styles.main}>
      <div className={styles.topline}><Link href="/research/watchlist">☆ {t("お気に入り", "Favorites")}</Link></div>
      <section className={styles.hero}>
        <p>STOCK DISCOVERY</p>
        <h1><span className={polish.desktopTitle}>{t("米国株を、すぐ調べる。", "Find a U.S. stock in seconds.")}</span><span className={polish.mobileTitle}>{t("米国株リサーチ", "U.S. stock research")}</span></h1>

        <label className={`${styles.search} ${polish.searchBox}`}><span aria-hidden="true">⌕</span><input autoComplete="off" inputMode="search" value={query} onChange={(event) => { themeSelection.current = null; setQuery(event.target.value); }} placeholder={t("例：NVDA、Micron、Palantir", "Try NVDA, Micron, or Palantir")} aria-label={t("米国株を検索", "Search U.S. stocks")} /></label>

      </section>

      <StockSearchHistory lang={lang} history={history} onSelect={setQuery} onClear={clearHistory} />

      {!query.trim() && !profile && <StockThemeDiscovery lang={lang} onSelect={ticker => { themeSelection.current = ticker; setQuery(ticker); }} />}

      {historyError && <p className={polish.resultHint} role="status">{t("このブラウザーで履歴を保存・消去できませんでした。", "Could not update history in this browser.")}</p>}

      {(query.trim() || errorMessage) && !directQuote && <div className={`${styles.layout} ${polish.resultLayout}`}>
        <section className={`${styles.results} ${polish.searchResults}`} aria-labelledby="results-title" aria-busy={loading}>
          <div className={styles.sectionHeading}><h2 id="results-title">{t("検索結果", "Matches")}</h2><span aria-live="polite">{loading ? t("検索中…", "Searching…") : `${results.length}${t("件", " results")}`}</span></div>
          {errorMessage && <div className={styles.error} role="alert"><strong>{t("取得経路を確認中", "Source unavailable")}</strong><p>{errorMessage}</p></div>}
          {!error && query.trim() && !loading && results.length === 0 && <div className={styles.empty}><strong>{t("該当銘柄が見つかりません", "No matching ticker")}</strong><p>{t("英語の企業名またはティッカーで検索してください。SEC名簿は全銘柄を保証するものではありません。", "Try an English company name or ticker. The SEC does not guarantee complete coverage.")}</p></div>}
          {selectedResultKey && results.length > 1 && <div className={polish.resultGuide}><button type="button" onClick={() => setSelectedResultKey(null)}>{t("ほかの検索結果を見る", "Show other matches")}</button></div>}
          <ol className={polish.compactResults}>{visibleResults.map((entry) => <li key={`${entry.ticker}:${entry.cik}:${entry.exchange}`}><button className={polish.resultButton} onClick={() => selectStock(entry)} aria-current={selectedResultKey === `${entry.ticker}:${entry.cik}:${entry.exchange}` ? "true" : undefined}><span className={styles.ticker}>{entry.ticker}</span><span className={styles.identity}><strong>{entry.name}</strong></span><span className={styles.exchange}>{exchangeLabel(entry.exchange)}{entry.tracked && <em>{t("監視中", "WATCHED")}</em>}</span><span className={polish.resultCta} aria-hidden="true">→</span></button></li>)}</ol>
          {asOf && <p className={styles.asOf}>{t("表示取得時刻", "Retrieved")}: <time dateTime={asOf}>{new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(new Date(asOf))} JST</time></p>}
        </section>

      </div>}

      {(profileLoading || profile || directQuote) && <div ref={marketTarget} className={polish.marketTarget}>
        {profileLoading && <div className={polish.profileLoading} role="status"><span className={styles.loader} /><strong>{t("銘柄情報を読み込み中…", "Loading company…")}</strong></div>}
        {directQuote && !profile && <MarketWorkspace key={`${directQuote.ticker}:${lang}`} {...directQuote} lang={lang} favorite={favorites.includes(directQuote.ticker)} onToggleFavorite={() => toggleFavorite(directQuote.ticker)} />}
        {profile && <MarketWorkspace key={`${profile.exchange}:${profile.ticker}:${lang}`} ticker={profile.ticker} exchange={profile.exchange} name={profile.name} lang={lang} favorite={favorites.includes(profile.ticker)} onToggleFavorite={() => toggleFavorite(profile.ticker)} />}
      </div>}

      {favoriteError && <p role="alert">{t("お気に入りを保存できませんでした。", "Could not save favorites.")}</p>}
      {profile && briefStatus === "approved" && brief && <section className={filingStyles.brief} aria-labelledby="annual-brief-title">
        <h2 id="annual-brief-title">{t("どんな会社？", "Company overview (Japanese)")}</h2>
        <p lang="ja">{brief.summaryJa}</p><small>{profile.latestAnnualFiling?.filingDate} · {t("年次報告書に基づく概要", "Based on the annual report")}</small>
        <h3>{t("何で稼ぐ？", "Business model")}</h3><p lang="ja">{brief.businessModelJa}</p>{profile.latestAnnualFiling && <BriefEvidence brief={brief} evidenceIds={brief.businessModelEvidenceIds} lang={lang} label={t("事業モデル", "Business model")} documentUrl={profile.latestAnnualFiling.documentUrl} />}
        <h3>{t("主なリスク", "Key risks")}</h3><ul>{brief.riskPointsJa.map((point, index) => <li key={index} lang="ja">{point.text}{profile.latestAnnualFiling && <BriefEvidence brief={brief} evidenceIds={point.evidenceIds} lang={lang} label={t("リスク", "Risk")} documentUrl={profile.latestAnnualFiling.documentUrl} />}</li>)}</ul>
        {profile.latestAnnualFiling && <BriefEvidence brief={brief} evidenceIds={brief.summaryEvidenceIds} lang={lang} label={t("企業概要", "Company overview")} documentUrl={profile.latestAnnualFiling.documentUrl} />}
      </section>}
      {profile && <details className={polish.sourceDrawer} key={profile.ticker}>
        <summary>{t("企業情報・公式資料", "Company details & filings")}<span>＋</span></summary>
        <div><p>{profile.name} · {exchangeLabel(profile.exchange)}</p>
          {profile.sicDescription && <p>{t("業種", "Industry")}: {profile.sicDescription}</p>}
          <ul>{profile.recentFilings.map((filing) => <li key={filing.accessionNumber}><time dateTime={filing.filingDate}>{filing.filingDate}</time><a href={filing.documentUrl} target="_blank" rel="noreferrer">{filingLabel(filing.form, lang)} ↗</a></li>)}</ul>
          <a href={profile.secProfileUrl} target="_blank" rel="noreferrer">{t("公式資料をすべて見る（SEC）↗", "All official filings (SEC) ↗")}</a>
        </div>
      </details>}
      <footer className={styles.footer}><span>TECH PHASE RESEARCH</span><p>{t("SECは名簿の正確性・網羅性を保証していません。検索結果は企業識別用で、売買推奨ではありません。", "The SEC does not guarantee directory accuracy or scope. Results identify issuers and are not investment recommendations.")}</p></footer>
    </main>
  </div>;
}
