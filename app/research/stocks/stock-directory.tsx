"use client";

import Link from "next/link";
import SiteHeader from "../site-header";
import HomeSidebar from "../home-sidebar";
import shell from "../research-tools.module.css";
import NavigationIcon from "../navigation-icon";
import { useSearchParams } from "next/navigation";
import { useStockFavorites } from "../use-stock-favorites";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { AnnualFilingBrief } from "@/lib/research/annual-filing-briefs";
import type { CompanyNetwork } from "@/lib/research/company-network";
import type { CompanyIntroduction } from "@/lib/research/company-introductions";
import type { StockDirectoryEntry, StockProfile } from "@/lib/research/stock-directory";
import { useResearchLanguage } from "../use-research-language";
import base from "../research.module.css";
import styles from "./stocks.module.css";
import polish from "./stock-polish.module.css";
import filingStyles from "./filings.module.css";
import { MarketWorkspace } from "./market-workspace";
import { SOURCES_NOTE } from "./source-list";
import SearchRows from "./search-rows";
import { WatchToast } from "../price/star-button";
import searchStyles from "./search-redesign.module.css";
import StockThemeDiscovery from "./stock-theme-discovery";
import StockSearchHistory from "./stock-search-history";
import { useStockHistory } from "./use-stock-history";
import { stockSearchReturnPosition, stockSearchUrl } from "@/lib/research/stock-search-navigation";
import { displayClock } from "@/lib/research/display-time";
import { asOfLabel } from "@/lib/research/search-result-card";
import type { SectorLabel } from "@/lib/research/watchlist-sector";
import type { FocusView } from "@/lib/research/search-focus-server";

type SearchResponse = { ok: boolean; results?: StockDirectoryEntry[]; error?: string; source?: string; asOf?: string };
type IntroducedStockProfile = StockProfile & { introduction?: CompanyIntroduction | null; network?: CompanyNetwork | null };
type ProfileResponse = { ok: boolean; profile?: IntroducedStockProfile; error?: string; profileSource?: string; asOf?: string };
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
    <a href={documentUrl} target="_blank" rel="noreferrer">{lang === "ja" ? "年次報告書を開く" : "Open annual filing"}</a>
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

/** `sectors`: the research roster's sector per ticker, the same registered tag the watchlist shows (page.tsx). `focus`: 「今日の注目」 and the
 * theme rows' day change from the shared snapshot, read by the page on the server (lib/research/search-focus-server.ts). */
export default function StockDirectory({ sectors, focus }: { sectors?: Record<string, SectorLabel>; focus?: FocusView | null } = {}) {
  const [lang, setLang] = useResearchLanguage();
  const searchParams = useSearchParams();
  const routeQuery = searchParams.get("q") ?? "";
  const routeSelection = searchParams.get("stock");
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const favorites = useStockFavorites();
  const { history, remember, clear: clearHistory, error: historyError } = useStockHistory();
  const [results, setResults] = useState<StockDirectoryEntry[]>([]);
  const [selectedResultKey, setSelectedResultKey] = useState<string | null>(null);
  const [directQuote, setDirectQuote] = useState<{ticker:string; exchange:string; name:string} | null>(null);
  const [profile, setProfile] = useState<IntroducedStockProfile | null>(null);
  const [brief, setBrief] = useState<AnnualFilingBrief | null>(null);
  const [briefStatus, setBriefStatus] = useState<BriefStatus>("idle");
  const [loading, setLoading] = useState(Boolean(query.trim()));
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const themeSelection = useRef<string | null>(null);
  const searchRequest = useRef(0);
  const profileRequest = useRef(0);
  const businessRequest = useRef(0);
  const marketTarget = useRef<HTMLDivElement>(null);
  const resultsTarget = useRef<HTMLElement>(null);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;

  // Owner, Nov 25: choosing a stock folds the search away and the stock's page starts at the top of the screen.
  useEffect(() => {
    if (!selectedResultKey) return;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
    return () => window.cancelAnimationFrame(frame);
  }, [selectedResultKey]);

  const openThemeResult = useEffectEvent((entry: StockDirectoryEntry) => { void selectStock(entry); });

  function changeQuery(value: string) {
    setQuery(value);
    window.history.replaceState(null, "", stockSearchUrl(value));
  }

  function closeDetail() {
    profileRequest.current += 1;
    businessRequest.current += 1;
    setSelectedResultKey(null);
    setProfile(null);
    setDirectQuote(null);
    setProfileLoading(false);
    setBrief(null);
    setBriefStatus("idle");
    setError(null);
  }

  const restoreRoute = useEffectEvent(() => {
    if (routeQuery !== query) { setQuery(routeQuery); return; }
    if (routeSelection) {
      const entry = results.find(item => `${item.ticker}:${item.cik}:${item.exchange}` === routeSelection);
      if (entry && routeSelection !== selectedResultKey) void selectStock(entry, false);
      return;
    }
    if (!selectedResultKey) return;
    closeDetail();
    requestAnimationFrame(() => {
      const y = stockSearchReturnPosition(window.history.state, routeQuery);
      if (y !== null) window.scrollTo({ top: y, behavior: "instant" });
      else resultsTarget.current?.scrollIntoView({ block: "start" });
    });
  });

  useEffect(() => { restoreRoute(); }, [routeQuery, routeSelection, results]);

  /** 「‹ 検索結果」: the results as they were (query, list, scroll position), the same as the browser's Back. */
  function showSearchResults() {
    if (stockSearchReturnPosition(window.history.state, query) !== null && routeSelection) { window.history.back(); return; }
    window.history.replaceState(null, "", stockSearchUrl(query));
    closeDetail();
  }

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

  async function selectStock(entry: StockDirectoryEntry, navigate = true) {
    const key = `${entry.ticker}:${entry.cik}:${entry.exchange}`;
    if (navigate && key !== selectedResultKey) {
      const state = { stockSearch: { query, y: window.scrollY } };
      window.history.replaceState(state, "", stockSearchUrl(query));
      // Next.js decorates replaceState's argument; do not reuse it for pushState.
      window.history.pushState({ stockSearch: state.stockSearch }, "", stockSearchUrl(query, key));
    }
    setSelectedResultKey(key);
    setProfile(null);
    setDirectQuote(null);
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
      if (data.profile.latestAnnualFiling && !data.profile.introduction) void loadBusiness(entry.ticker);
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
  // A chosen stock folds the search screen away (owner, Nov 25): the heading, history, results and their time are hidden, not removed, so
  // 「‹ 検索結果」 and Back find the same list (and its prices) at the same scroll position.
  const detail = Boolean(selectedResultKey);
  // The slim field names the chosen stock (sheet: 「⌕ NVDA ×」); the search itself (e.g. 「NV」) is kept for 「‹ 検索結果」 and Back.
  const selectedTicker = directQuote?.ticker ?? profile?.ticker ?? selectedResultKey?.split(":")[0] ?? "";
  const asOfNote = asOf ? <time dateTime={asOf}>{asOfLabel(displayClock(asOf, lang), lang)}</time> : null;
  // The first screen (owner, Nov 26): nothing typed and no stock chosen. It fits one phone screen, so the page's footer is left out there.
  const start = !query.trim() && !detail && !profile && !errorMessage;
  const openTicker = (ticker: string) => { themeSelection.current = ticker; changeQuery(ticker); };

  return <div className={start ? `${base.app} ${searchStyles.fit}` : base.app} lang={lang}>
    <a className={base.skip} href="#stock-search-main">{t("本文へ移動", "Skip to content")}</a>
    <SiteHeader lang={lang} setLang={setLang} nav={<nav className={base.primaryNav} aria-label={t("メインメニュー", "Main navigation")}><Link href="/research/capital-map"><NavigationIcon name="changes" />{t("資本マップ", "CAPITAL MAP")}</Link><Link href="/research/stocks" aria-current="page"><NavigationIcon name="search" />{t("米国株を探す", "Find stocks")}</Link><Link href="/research#metrics"><NavigationIcon name="metrics" />{t("決算・指標", "Financials")}</Link></nav>} />
    <div className={shell.withSidebar}>
    <aside className={shell.toolSidebar}><HomeSidebar lang={lang} tab="home" standalone pathname="/research/stocks" /></aside>
    <WatchToast />
    <main id="stock-search-main" className={`${styles.main} ${styles.sidebarMain}`}>
      {detail && <div className={searchStyles.detailBar}>
        <button type="button" className={searchStyles.backButton} onClick={showSearchResults}><span aria-hidden="true">‹</span>{t("検索結果", "Results")}</button>
        <div className={searchStyles.slimField}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
          <input autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="search" value={selectedTicker} onChange={(event) => { themeSelection.current = null; changeQuery(event.target.value); }} aria-label={t("米国株を検索", "Search U.S. stocks")} />
          <button type="button" aria-label={t("入力を消す", "Clear")} onClick={() => { themeSelection.current = null; changeQuery(""); }}><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg></button>
        </div>
      </div>}
      <div hidden={detail}>
      <section className={searchStyles.hero}>
        <p className={searchStyles.eyebrow}>STOCK DISCOVERY</p>
        <h1 className={searchStyles.title}>{t("銘柄検索", "Stock search")}</h1>
        <div className={searchStyles.bar}>
          <span className={searchStyles.glass} aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg></span>
          <input className={searchStyles.input} autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="search" value={query} onChange={(event) => { themeSelection.current = null; changeQuery(event.target.value); }} aria-label={t("米国株を検索", "Search U.S. stocks")} />
          {/* The placeholder (owner, Nov 26), drawn over the empty field so a slowly blinking caret can follow it; the field's own caret takes over on focus. */}
          {!query && <span className={searchStyles.hint} aria-hidden="true">{t("会社名・ティッカー", "Company or ticker")}<i /></span>}
          {query && <button type="button" className={searchStyles.clear} aria-label={t("入力を消す", "Clear")} onClick={() => { themeSelection.current = null; changeQuery(""); }}><svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg></button>}
        </div>
      </section>

      <StockSearchHistory lang={lang} history={history} onSelect={openTicker} onClear={clearHistory} />

      {!query.trim() && !profile && <StockThemeDiscovery lang={lang} focus={focus} onSelect={openTicker} />}

      {historyError && <p className={polish.resultHint} role="status">{t("このブラウザーで履歴を保存・消去できませんでした。", "Could not update history in this browser.")}</p>}
      </div>

      {(query.trim() || errorMessage) && !directQuote && <div className={`${styles.layout} ${polish.resultLayout}`} hidden={detail}>
        <section ref={resultsTarget} className={`${styles.results} ${polish.searchResults}`} aria-labelledby="results-title" aria-busy={loading}>
          <div className={searchStyles.listHead}><h2 id="results-title" style={{ margin: 0, fontSize: 13, fontWeight: 400, color: "#8c98ab" }}>{t("検索結果", "Search results")}</h2><span aria-live="polite">{loading ? t("検索中…", "Searching…") : `${results.length}${t("件", results.length === 1 ? " result" : " results")}`}</span></div>
          {errorMessage && <div className={styles.error} role="alert"><strong>{t("取得経路を確認中", "Source unavailable")}</strong><p>{errorMessage}</p></div>}
          {!error && query.trim() && !loading && results.length === 0 && <div className={styles.empty}><strong>{t("該当銘柄が見つかりません", "No matching ticker")}</strong><p>{t("英語の企業名またはティッカーで検索してください。SEC名簿は全銘柄を保証するものではありません。", "Try an English company name or ticker. The SEC does not guarantee complete coverage.")}</p></div>}
          <SearchRows results={results} lang={lang} onSelect={selectStock} sectors={sectors} />
          {asOf && <p className={styles.asOf}><time dateTime={asOf}>{asOfLabel(displayClock(asOf, lang), lang)}</time></p>}
        </section>

      </div>}

      {(selectedResultKey || profileLoading || profile || directQuote) && <div ref={marketTarget} className={polish.marketTarget}>
        {profileLoading && <div className={polish.profileLoading} role="status"><span className={styles.loader} /><strong>{t("銘柄情報を読み込み中…", "Loading company…")}</strong></div>}
        {directQuote && !profile && <MarketWorkspace key={`${directQuote.ticker}:${lang}`} {...directQuote} lang={lang} asOf={asOfNote} />}
        {profile && <MarketWorkspace key={`${profile.exchange}:${profile.ticker}`} ticker={profile.ticker} exchange={profile.exchange} name={profile.name} lang={lang} introduction={profile.introduction} network={profile.network} asOf={asOfNote} />}
      </div>}

      {profile && !profile.introduction && briefStatus === "approved" && brief && <section className={filingStyles.brief} aria-labelledby="annual-brief-title">
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
          <ul>{profile.recentFilings.map((filing) => <li key={filing.accessionNumber}><time dateTime={filing.filingDate}>{filing.filingDate}</time><a href={filing.documentUrl} target="_blank" rel="noreferrer">{filingLabel(filing.form, lang)}</a></li>)}</ul>
          <a href={profile.secProfileUrl} target="_blank" rel="noreferrer">{t("公式資料をすべて見る（SEC）", "All official filings (SEC)")}</a>
        </div>
      </details>}
      {!start && <footer className={styles.footer}><span>TECH PHASE RESEARCH</span><p>{t(SOURCES_NOTE.ja, SOURCES_NOTE.en)}</p></footer>}
    </main>
    </div>
  </div>;
}
