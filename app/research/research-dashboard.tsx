"use client";

import { useMemberArticle } from "./use-member-article";
import NavigationIcon from "./navigation-icon";
import CompanyDirectory from "./companies/company-directory";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import SiteHeader from "./site-header";
import type { Language, ResearchEvent } from "@/lib/research/data";
import { metricNames } from "@/lib/research/data";
import { compareMetrics } from "@/lib/research/quality";
import { valueLabel, dateLabel } from "@/lib/research/presentation";
import { researchViewFromHash, researchViewHashes, type ResearchView } from "@/lib/research/navigation";
import { effectiveHash, rememberHash } from "@/lib/research/view-hash";
import { useResearchLanguage } from "./use-research-language";
import styles from "./research.module.css";
import HomeTools, { HomeHelp } from "./home-tools";
import FreshnessNotice from "./freshness-notice";
import HomeToday from "./home-today";
import type { InitialNewsSnapshot } from "@/lib/research/general-news";
import NewsFeed from "./news/news-feed";
import ResearchPulse from "./research-pulse";
import HomeHero from "./home-hero";
import HomeSidebar from "./home-sidebar";
import ResearchNotebook from "./research-notebook";
import SavedInkBadge from "./saved-ink-badge";
import { matchesResearchSearch, orderSavedEvents } from "@/lib/research/saved-collection";

import { useSavedResearch } from "./use-saved-research";
import { notebookKey } from "@/lib/research/saved-document";
import SavedSyncStatus from "./saved-sync-status";
function subscribeView(callback: () => void) {
  window.addEventListener("hashchange", callback);
  window.addEventListener("popstate", callback);
  return () => { window.removeEventListener("hashchange", callback); window.removeEventListener("popstate", callback); };
}
function viewSnapshot() { return researchViewFromHash(effectiveHash()) ?? "home"; }

function Arrow() { return <span aria-hidden="true">↗</span>; }
function Bookmark({ filled = false }: { filled?: boolean }) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6"><path d="M6 3h12v18l-6-4-6 4V3Z" /></svg>;
}
type MonitoredCompany = {
  ticker: string;
  name: string;
  sector: { ja: string; en: string };
  verified: boolean;
};

export default function ResearchDashboard({ events, monitoredCompanies, initialNews }: { events: ResearchEvent[]; monitoredCompanies: MonitoredCompany[]; initialNews?: InitialNewsSnapshot | null }) {
  const [lang, setLang] = useResearchLanguage();
  const restoredView = useSyncExternalStore(subscribeView, viewSnapshot, () => null);
  const tab = restoredView ?? "home";
  const [savedActiveId, setSavedActiveId] = useState("");
  const [researchArticleOpen, setResearchArticleOpen] = useState(false);
  const savedReturn = useRef<{ id: string; top: number; scroll: number } | null>(null);
  const cardButtons = useRef(new Map<string, HTMLButtonElement>());
  const returnFrame = useRef(0);
  const detailFrame = useRef(0);
  const [ticker, setTicker] = useState("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(events[0]?.id ?? "");
  const [storageError, setStorageError] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const collection = useSavedResearch();
  const saved = collection.document.saved;
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;

  useEffect(() => {
    const syncHash = () => {
      const next = researchViewFromHash(effectiveHash());
      if (next) {
        if (next === "saved") {
          const id = window.history.state?.techPhaseSavedArticle;
          setSavedActiveId(typeof id === "string" ? id : "");
          if (!id && savedReturn.current) {
            cancelAnimationFrame(returnFrame.current);
            returnFrame.current = requestAnimationFrame(() => {
              returnFrame.current = requestAnimationFrame(() => {
                const position = savedReturn.current;
                if (!position) return;
                const button = cardButtons.current.get(position.id);
                window.scrollTo({ top: button ? window.scrollY + button.getBoundingClientRect().top - position.top : position.scroll, behavior: "instant" });
                button?.focus({ preventScroll: true });
              });
            });
          }
        }
        const shownHash = effectiveHash();
        const noteId = shownHash.startsWith("#what-changed/") ? shownHash.slice("#what-changed/".length) : "";
        setResearchArticleOpen(Boolean(noteId));
        if (noteId) { setActiveId(noteId); setQuery(""); setTicker("all"); setCategory("all"); }
        if (next === "home") { setQuery(""); setTicker("all"); setCategory("all"); }
      }
    };
    // A fresh visit/reload starts with the collection; history traversal within
    // this mounted view can still reopen an explicitly selected article.
    if (window.history.state?.techPhaseSavedArticle) {
      window.history.replaceState({ ...window.history.state, techPhaseSavedArticle: null }, "", window.location.href);
    }
    syncHash();
    window.addEventListener("hashchange", syncHash);
    window.addEventListener("popstate", syncHash);
    return () => {
      cancelAnimationFrame(returnFrame.current);
      cancelAnimationFrame(detailFrame.current);
      window.removeEventListener("hashchange", syncHash);
      window.removeEventListener("popstate", syncHash);
    };
  }, []);

  const latestReview = events.map(event => event.reviewedOn).sort().at(-1);
  const matches = events.filter((event) => {
    const fields = [event.ticker, event.company, event.title.ja, event.title.en, event.summary.ja, event.summary.en];
    const marks = tab === "saved" ? collection.document.notebooks[notebookKey(event.id, lang)] ?? [] : [];
    return (tab === "saved" || ((ticker === "all" || event.ticker === ticker) && (category === "all" || event.category === category))) &&
      matchesResearchSearch(fields, query, marks) &&
      (tab !== "saved" || saved.includes(event.id));
  });
  const filtered = tab === "saved" ? orderSavedEvents(matches, saved, "saved") : matches;
  const hasSavedArticles = saved.some(id => events.some(event => event.id === id));
  const showingResearchArticle = tab === "changes" && researchArticleOpen;
  const selected = tab === "saved" ? filtered.find(event => event.id === savedActiveId) : filtered.find((event) => event.id === activeId) ?? filtered[0];
  const article = useMemberArticle(selected?.id, Boolean(selected?.locked && (tab === "changes" || tab === "saved")));
  const active = article.event ?? selected;
  const activeCompanyName = active ? monitoredCompanies.find(company => company.ticker === active.ticker)?.name ?? active.company : "";
  const comparisonPeriods = [...new Set(active?.metrics.flatMap((metric) => {
    const previous = active.previous?.find((item) => item.name === metric.name);
    return previous && compareMetrics(metric, previous).ok ? [`${previous.period} → ${metric.period}`] : [];
  }) ?? [])];
  const allMetrics = filtered.flatMap((event) => event.metrics.map((metric) => ({ metric, event })));
  const kinds = { acquisition: t("買収", "Acquisition"), partnership: t("提携", "Partnership"), earnings: t("決算", "Earnings"), capacity: t("設備・電力", "Capacity"), financing: t("資金調達", "Funding"), product: t("製品・料金", "Product & pricing"), "external-research": t("外部調査・評価", "External research") };
  function toggleSaved(id: string) {
    const removing = saved.includes(id);
    if (removing && !window.confirm(t("この記事を保存一覧から外しますか？", "Remove this article from saved research?"))) return;
    setStorageError(!collection.update(current => ({ ...current, saved: removing ? current.saved.filter(value => value !== id) : current.saved.includes(id) ? current.saved : [...current.saved, id] })));
  }
  function selectEvent(id: string) {
    setActiveId(id);
    if (tab === "saved") {
      if (!savedActiveId) {
        savedReturn.current = { id, top: cardButtons.current.get(id)?.getBoundingClientRect().top ?? 0, scroll: window.scrollY };
        window.history.pushState({ ...window.history.state, techPhaseSavedArticle: id }, "", "#saved"); rememberHash("#saved");
      } else { window.history.replaceState({ ...window.history.state, techPhaseSavedArticle: id }, "", "#saved"); rememberHash("#saved"); }
      setSavedActiveId(id);
    }
    if (tab === "changes") {
      setResearchArticleOpen(true);
      window.history.pushState(null, "", `#what-changed/${id}`); rememberHash(`#what-changed/${id}`);
    }
    if (tab === "saved" || tab === "changes" || window.matchMedia("(max-width: 1150px)").matches) {
      cancelAnimationFrame(detailFrame.current);
      // Wait for the selected article and collection layout to commit, then
      // place its top below the actual sticky header (including safe-area padding).
      detailFrame.current = requestAnimationFrame(() => {
        detailFrame.current = requestAnimationFrame(() => {
          const detail = detailRef.current;
          if (!detail) return;
          const headerHeight = document.querySelector<HTMLElement>("header[data-plan]")?.getBoundingClientRect().height ?? 0;
          window.scrollTo({ top: Math.max(0, window.scrollY + detail.getBoundingClientRect().top - headerHeight - 12), behavior: "instant" });
          detail.focus({ preventScroll: true });
        });
      });
    }
  }
  function returnToSaved() {
    if (window.history.state?.techPhaseSavedArticle && savedReturn.current) window.history.back();
    else {
      window.history.replaceState({ ...window.history.state, techPhaseSavedArticle: null }, "", "#saved");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }
  function clearFilters() { setQuery(""); setTicker("all"); setCategory("all"); }
  function openView(next: ResearchView) {
    const hash = researchViewHashes[next];
    if (next !== "saved") savedReturn.current = null;
    if (next === "saved" && tab === "saved" && savedActiveId) { returnToSaved(); return; }
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    else window.history.replaceState({ ...window.history.state, techPhaseSavedArticle: null }, "", hash);
    rememberHash(hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    if (next === "home") clearFilters();
    requestAnimationFrame(() => {
      (next === "home" || next === "companies" || next === "pro" || next === "changes" ? document.getElementById("research-main") : workspaceRef.current)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (restoredView === null) return <div className={styles.viewLoading} aria-busy="true" aria-label={t("読み込み中", "Loading")} />;

  return <div className={styles.app} lang={lang}>
    <a className={styles.skip} href="#research-main">{t("本文へ移動", "Skip to content")}</a>
    <SiteHeader lang={lang} setLang={setLang} nav={<nav className={`${styles.primaryNav} ${tab === "companies" ? styles.companyNav : ""}`} aria-label={t("メインメニュー", "Main navigation")}>
        <Link href="/research/capital-map"><NavigationIcon name="changes" /><span>{t("資本マップ", "CAPITAL MAP")}</span></Link>
        <Link href="/research/stocks"><NavigationIcon name="search" /><span>{t("米国株を探す", "Find stocks")}</span></Link>
        <button aria-current={tab === "companies" ? "page" : undefined} onClick={() => openView("companies")}><NavigationIcon name="companies" /><span>{t("監視22銘柄リスト", "22-stock watch list")}</span></button>
        <button aria-current={tab === "metrics" ? "page" : undefined} onClick={() => openView("metrics")}><NavigationIcon name="metrics" /><span>{t("決算・指標", "Financials")}</span></button>
        <button aria-current={tab === "saved" ? "page" : undefined} onClick={() => openView("saved")}><NavigationIcon name="saved" /><span>{t("保存", "Saved")}</span><small>{saved.filter((id) => events.some((event) => event.id === id)).length}</small></button>

      </nav>} />

    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <HomeSidebar lang={lang} tab={tab} companyCount={monitoredCompanies.length} savedCount={saved.filter((id) => events.some((event) => event.id === id)).length} openView={openView} />
      </aside>

      <main id="research-main" className={styles.main}>

        {tab === "home" && <HomeHero lang={lang} />}

        {tab !== "companies" && tab !== "saved" && tab !== "home" && tab !== "changes" && <div className={styles.heading}><div><p className={styles.eyebrow}>THE RESEARCH DESK</p><h1 id="research-page-title">{tab === "pro" ? "Tech Phase PRO" : tab === "metrics" ? t("数字を、正しく比べる。", "Compare the right numbers.") : t("米国株の変化を、根拠付きで。", "U.S. stock change, backed by evidence.")}</h1>{<p>{tab === "pro" ? t("変化を読み、一歩先へ。", "Read the shifts. Think ahead.") : t("事実、解釈、次の確認点をひとつの画面に。", "The facts, the interpretation, and what to watch next.")}</p>}</div>{tab !== "pro" && <div className={styles.reviewDate}><span>{t("資料照合日", "REVIEWED ON")}</span><strong>{latestReview?.replaceAll("-", ".") ?? "—"}</strong></div>}</div>}

        {tab === "home" && <>
          <ResearchPulse lang={lang} />
          <FreshnessNotice lang={lang} />
          <HomeTools lang={lang} onPro={() => openView("pro")} onWatch={() => openView("companies")} />
          <HomeToday lang={lang} />
          <NewsFeed lang={lang} initialNews={initialNews} />
          <HomeHelp lang={lang} />
        </>}

        {tab === "companies" && <CompanyDirectory companies={monitoredCompanies} lang={lang} />}

        {tab === "pro" && <section id="tech-phase-pro" className={`${styles.accessMatrix} ${styles.proPlans}`} aria-labelledby="research-page-title">
          <div className={styles.planStack}>
            <article className={styles.accessCard}>
              <div className={styles.accessStatus}><span>FREE</span></div>
              <p className={styles.planPrice}>{t("¥0", "$0")}<small>{t(" / 月", " / month")}</small></p>
              <h3>{t("米国株を調べる、基本の機能。", "The essentials for exploring U.S. stocks.")}</h3>
              <ul>{[
                t("米国株の銘柄検索", "U.S. stock search"),
                t("株価とチャートの確認", "Stock quotes and charts"),
                t("指数・債券・為替のマーケット情報", "Indices, bonds and currencies"),
                t("ウォッチリストへの銘柄登録", "Your stock watchlist"),
                t("決算・経済指標カレンダー", "Earnings and economic calendar"),
                t("決算の主要数字と変化の要点", "Key earnings figures and changes"),
                t("独自リサーチの無料公開記事", "Selected full research articles"),
              ].map(item => <li key={item}>{item}</li>)}</ul>
              <Link href="/research/stocks">{t("無料で銘柄を探す", "Explore stocks for free")} <Arrow /></Link>
            </article>
            <article className={`${styles.accessCard} ${styles.proCard}`}>
              <div className={styles.accessStatus}><span>TECH PHASE PRO</span></div>
              <p className={styles.planPrice}>{t("¥2,980", "$20")}<small>{t(" / 月", " / month")}</small></p>
              <button className={styles.planCta} disabled>{t("お申し込み準備中", "Coming soon")}</button>
              <p className={styles.planIncludes}>{t("無料プランのすべての機能に加えて", "Everything in Free, plus")}</p>
              <ul className={styles.proBenefits}>
                {[
                t("決算の裏側まで読み解く独自リサーチ", "In-depth earnings research"),
                t("業界の動きから企業の競争力を分析", "Industry trends and competitive strengths"),
                t("予想利益から株価の妥当性を検証", "Earnings and P/E valuation"),
                t("成長の転換点と、その先の展開を読む", "Growth turning points and what comes next"),
                t("決算後に変わった専門家の見方を追う", "How analyst views change after earnings"),
                t("企業の先行きを左右するニュースを厳選", "Key news shaping company prospects"),
                t("目標株価の変更をスマホに通知", "Price target alerts on your phone"),
              ].map(item => <li key={item}>{item}</li>)}
                <li><strong>{t("週刊 Tech Phase PRO", "Tech Phase PRO Weekly")}</strong>{t("｜変化と展望", " · Outlook")}</li>
                <li><strong>{t("リゼルに聞く", "Ask Rizel")}</strong>{t("｜会員の疑問を深掘り", " · Member questions explored")}</li>
                <li><strong>{t("リゼルのひとりごと", "RIZEL’s Notes")}</strong>{t("｜相場の着眼点", " · Market perspectives")}</li>
                <li><strong>{t("銘柄比較 PRO", "Stock comparison PRO")}</strong>{t("｜気になる2〜3銘柄を瞬時に判断", " · Assess 2–3 stocks at a glance")}</li>
              </ul>
            </article>
          </div>
        </section>}

        {(tab === "changes" || tab === "metrics" || tab === "saved") && <section id="what-changed" ref={workspaceRef} className={`${styles.workspace} ${tab === "saved" ? styles.savedWorkspace : ""}`}>
          <span id="metrics" className={styles.anchorTarget} aria-hidden="true" />
          <span id="saved" className={styles.anchorTarget} aria-hidden="true" />
          {tab === "saved" && <header className={styles.savedHeader}>
            <div><span className={styles.savedEyebrow}>MY RESEARCH</span><h1>{t("保存したリサーチ", "Saved research")}</h1><p>{t("気になる記事にメモを書き込み、自分だけのノートに。", "Add notes. Make it yours.")}</p></div>
            {collection.ready && <div className={styles.savedCount}><Bookmark filled /><strong>{saved.filter((id) => events.some((event) => event.id === id)).length}</strong><span>{t("保存済み", "Saved")}</span></div>}
          </header>}
          {!showingResearchArticle && (tab !== "saved" || hasSavedArticles) && <div className={`${styles.toolbar} ${tab === "saved" ? styles.savedToolbar : ""}`}>
            {tab !== "changes" && <div className={styles.sectionTitle}><h2>{tab === "metrics" ? t("指標一覧", "Metrics") : t("保存一覧", "Your collection")}</h2><span>{tab === "metrics" ? allMetrics.length : filtered.length}</span></div>}
            <label className={styles.search}><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input aria-label={tab === "saved" ? t("銘柄・キーワード・メモで検索", "Search ticker, keyword or notes") : t("銘柄・キーワードで検索", "Search ticker or keyword")} placeholder={tab === "saved" ? t("保存した記事を検索", "Search saved research") : t("銘柄・キーワードを検索", "Search ticker or keyword")} value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          </div>}
          {tab !== "saved" && !showingResearchArticle && <div className={styles.filters}>
            {[{ id: "all", label: t("すべて", "All topics") }, { id: "cloud", label: t("AIクラウド", "AI cloud") }, { id: "memory", label: t("半導体", "Semiconductors") }].map((item) => <button key={item.id} aria-pressed={category === item.id} onClick={() => { setCategory(item.id); setTicker("all"); }}>{item.label}</button>)}
            {ticker !== "all" && <button className={styles.activeTicker} onClick={() => setTicker("all")} aria-label={t(`${ticker}の絞り込みを解除`, `Clear ${ticker} filter`)}>{ticker} ×</button>}
            <span className={styles.sortLabel}>{t("発表日の新しい順", "Newest announcement first")}</span>
          </div>}
          {storageError && <p role="alert" className={styles.notice}>{t("このブラウザーでは保存できません。ストレージの設定をご確認ください。", "Saving is unavailable in this browser. Check your storage settings.")}</p>}
          {((tab === "saved" && collection.status !== "synced" && collection.status !== "guest") || collection.status === "error" || collection.status === "conflict") && <SavedSyncStatus collection={collection} lang={lang} />}

          {tab === "metrics" ? <div className={styles.tableWrap}>
            {allMetrics.length ? <table><caption>{t("実績・見通し・ARRを区別。金額のMは百万米ドル。", "Actuals, guidance, and run-rate are distinct. M denotes USD millions.")}</caption><thead><tr>{[t("銘柄 / 指標", "Ticker / metric"), t("値", "Value"), t("対象・基準", "Scope / basis"), t("期間", "Period"), t("根拠", "Source")].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{allMetrics.map(({ metric, event }) => <tr key={`${event.id}:${metric.name}`}><th scope="row"><span className={styles.tableTicker}>{event.ticker}</span>{metricNames[metric.name]?.[lang] ?? metric.name}</th><td className={styles.tableValue}>{valueLabel(metric)}</td><td>{metric.scope}<small>{metric.basis} · {metric.kind === "guidance" ? t("会社見通し", "Guidance") : metric.kind === "run-rate" ? t("年換算指標", "Run-rate") : t("実績", "Actual")}</small></td><td>{metric.period}</td><td><a href={event.sources.find((source) => source.id === metric.sourceId)?.url} target="_blank" rel="noreferrer">{t("原文", "Source")} <Arrow /></a></td></tr>)}</tbody></table> : <Empty lang={lang} onReset={clearFilters} />}
          </div> : <div className={`${styles.researchGrid} ${showingResearchArticle ? styles.articleOnly : ""}`}>
            {!showingResearchArticle && <div className={styles.eventList}>
              {filtered.map((event) => <article key={event.id} className={`${styles.eventCard} ${active?.id === event.id ? styles.selected : ""}`}>
                <div className={styles.eventMeta}><span className={styles.ticker}>{event.ticker}</span><span>{kinds[event.kind]}</span><time dateTime={event.publishedOn}>{dateLabel(event.publishedOn, lang)}</time><button className={styles.saveButton} disabled={!collection.editable} aria-label={saved.includes(event.id) ? t("保存を解除", "Unsave research") : t("リサーチを保存", "Save research")} aria-pressed={saved.includes(event.id)} onClick={() => toggleSaved(event.id)}><Bookmark filled={saved.includes(event.id)} />{tab !== "saved" && <span>{saved.includes(event.id) ? t("保存済み", "Saved") : t("保存", "Save")}</span>}</button></div>
                <button ref={node => { if (node) cardButtons.current.set(event.id, node); else cardButtons.current.delete(event.id); }} className={styles.eventOpen} aria-pressed={active?.id === event.id} onClick={() => selectEvent(event.id)}><h3>{event.title[lang]}</h3>{event.id === "mu-q3-2026" && <small>{t("PRO分析の無料サンプル", "Free sample of PRO research")}</small>}<p>{event.summary[lang]}</p><span className={styles.eventFoot}><span>{event.kind === "external-research" ? t("外部調査", "External research") : t("根拠資料", "Sources")} {event.sources.length}<span className={styles.dot}>·</span>{t("原文付き", "Evidence linked")}</span><span>{tab === "saved" && <SavedInkBadge hasInk={Boolean(collection.document.notebooks[notebookKey(event.id, lang)]?.length)} lang={lang} />}{t("詳しく見る", "Read research")} <span aria-hidden="true">→</span></span></span></button>
              </article>)}
              {!filtered.length && (tab === "saved" && !collection.ready ? <div className={styles.savedLoading} role="status" aria-label={t("読み込み中", "Loading saved research")}><span /><span /><span /></div> : tab === "saved" && !saved.some((id) => events.some((event) => event.id === id)) ? <div className={styles.savedEmpty}>
                <span className={styles.savedEmptyIcon}><Bookmark /></span>
                <h2>{t("気づきを残す、自分だけの一冊。", "A personal notebook for your insights.")}</h2>
                <p>{t("何度でも立ち戻れる場所に。", "A place to return to, time and again.")}</p>
                <button onClick={() => { clearFilters(); openView("changes"); }}>{t("保存する記事を調べる", "Find articles to save")}</button>
              </div> : <Empty lang={lang} onReset={clearFilters} />)}
            </div>}

            {active && (tab !== "changes" || showingResearchArticle) && <article ref={detailRef} tabIndex={-1} className={styles.detail} aria-label={t("リサーチ詳細", "Research detail")}>
              {tab === "saved" && <button className={styles.backToSaved} onClick={returnToSaved}><span aria-hidden="true">◀</span> {t("保存一覧に戻る", "Back to collection")}</button>}
              {tab !== "saved" && <div className={styles.articleSaveBar}>
                {showingResearchArticle && <button className={styles.backToSaved} onClick={() => openView("changes")}><span aria-hidden="true">◀</span> {t("記事一覧に戻る", "Back to articles")}</button>}
                <button className={styles.articleSaveButton} disabled={!collection.editable} aria-pressed={saved.includes(active.id)} aria-label={saved.includes(active.id) ? t("この記事の保存を解除", "Unsave this article") : t("この記事を保存する", "Save this article")} onClick={() => toggleSaved(active.id)}><Bookmark filled={saved.includes(active.id)} />{!saved.includes(active.id) && <span>{t("保存する", "Save article")}</span>}</button>
                {saved.includes(active.id) && <button className={styles.openSavedButton} onClick={() => { clearFilters(); openView("saved"); }}>{t("保存一覧へ", "View saved articles")}</button>}
                <span className={styles.articleSaveStatus} role="status">{storageError ? t("保存できませんでした。ブラウザーの設定をご確認ください。", "Could not save. Check your browser settings.") : ""}</span>
              </div>}
              <ResearchNotebook key={`${collection.scope}:${active.id}:${lang}:${Boolean(active.locked)}`} raw={JSON.stringify(collection.document.notebooks[notebookKey(active.id, lang)] ?? [])} onCommit={(raw, marks) => collection.commitMarks(active.id, lang, raw, marks)} editable={collection.editable} lang={lang} title={active.title[lang]} enabled={tab === "saved" || saved.includes(active.id)}>
              <div className={styles.detailTop}><span className={styles.eyebrow}>RESEARCH NOTE</span><span className={styles.version}>{active.analysisAsOf ? "v3" : active.analysis ? "v2" : "v1"} · {(active.id === "mu-q4-2026" || active.id.startsWith("x-result-")) ? t("決算速報", "Earnings update") : active.id.startsWith("ir-result-") ? t("公式発表", "Company update") : active.analysisAsOf ? t("分析更新", "Updated analysis") : t("過去事例", "Historical")}</span></div>
              <div className={styles.detailCompany}><Link className={styles.detailTicker} href={`/research/companies/${active.ticker}`} aria-label={t(`${active.ticker}の銘柄ページ`, `${active.ticker} company research`)}>{activeCompanyName}{activeCompanyName !== active.ticker && `（${active.ticker}）`}</Link></div>
              <h2>{active.title[lang]}</h2>{active.id === "mu-q3-2026" && <p>{t("PRO分析の無料サンプルです。ほかの詳細分析はPRO会員向けです。", "A free sample of PRO research. Other in-depth analysis requires PRO membership.")}</p>}
              <dl className={styles.announcementContext}>
                {active.analysisAsOf && <div><dt>{t("分析基準日", "Analysis as of")}</dt><dd>{dateLabel(active.analysisAsOf, lang)}</dd></div>}
                <div><dt>{active.dateBasis === "detection" ? t("取得日", "Detected") : t("発表日", "Announced")}</dt><dd><time dateTime={active.publishedOn}>{dateLabel(active.publishedOn, lang)}</time></dd></div>
                <div><dt>{t("比較の基準", "Comparison basis")}</dt><dd>{comparisonPeriods.length ? comparisonPeriods.map((period) => <span key={period}>{period}</span>) : t("この発表で確認した内容", "Findings from this announcement")}</dd></div>
              </dl>
              <div className={styles.change}><span>{t("今回の変化", "WHAT CHANGED")}</span><p>{active.change[lang]}</p></div>
              {active.metrics.length > 0 && <div className={styles.metricStrip}>{active.metrics.slice(0, 2).map((metric) => {
                const previous = active.previous?.find((item) => item.name === metric.name);
                const comparison = previous && compareMetrics(metric, previous);
                return <div key={metric.name}><span>{metricNames[metric.name]?.[lang] ?? metric.name}</span><strong>{valueLabel(metric)}</strong><small>{metric.period} · {metric.basis}</small>{previous && <small>{t("前回", "Prior")}: {valueLabel(previous)}</small>}<small>{metric.kind === "guidance" ? t("会社見通し", "Guidance") : metric.kind === "run-rate" ? t("年換算・売上実績とは別", "Annualized run-rate, not actual revenue") : metric.scope}</small>{comparison?.ok && <b>{comparison.value >= 0 ? "+" : ""}{comparison.value.toFixed(1)}{comparison.unit === "pp" ? t("pt", "pp") : "%"}<em>{previous?.period} {t("比", "comparison")}</em></b>}</div>;
              })}</div>}
              <section className={styles.detailSection}><h3><span className={styles.sectionNumber}>01</span>{t("分析の前提となるデータ", "Data behind the analysis")}</h3><ul className={styles.facts}>{active.facts.map((fact, index) => <li key={index}>{fact.text[lang]} {!active.id.startsWith("x-result-") && fact.sourceIds.map((id) => <a key={id} href={active.sources.find((source) => source.id === id)?.url} target="_blank" rel="noreferrer" aria-label={t(`根拠資料${active.sources.findIndex((source) => source.id === id) + 1}を開く`, `Open source ${active.sources.findIndex((source) => source.id === id) + 1}`)}>[{active.sources.findIndex((source) => source.id === id) + 1}]</a>)}</li>)}</ul></section>
              {active.locked ? <section className={styles.detailSection}>
                <h3>Tech Phase PRO</h3>
                <p>{article.status === "loading" ? t("会員情報を確認中…", "Checking membership…") : article.status === "error" ? t("接続を確認して、もう一度記事を開いてください。", "Check your connection and reopen the article.") : t("この先の分析はPRO会員向けです。", "The full analysis is available to PRO members.")}</p>
                <Link href="/research/account">{t("ログイン・会員情報", "Sign in / Membership")}</Link>
              </section> : <>
              <section className={styles.detailSection}><h3><span className={styles.sectionNumber}>02</span>{t("この先をどう読むか", "Reading what comes next")}<small>{t("分析・解釈", "INTERPRETATION")}</small></h3>{active.interpretation[lang].split("\n\n").map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>
              {active.analysis?.map((part, index) => <section className={styles.detailSection} key={`analysis-${index}`}><h4 className={styles.analysisHeading}>{part.heading[lang]}</h4><p>{part.body[lang]}</p></section>)}
              {active.valuation && <section className={styles.detailSection}><h3>{t("利益予想が変わると、PERはどう変わるか", "P/E sensitivity to earnings")}</h3><p>{t(`株価 $${active.valuation.price.toLocaleString("en-US")}（${active.valuation.priceDate}米国終値）を固定。${active.valuation.fiscalYear}の調整後EPS予想に対する試算。`, `Price held at $${active.valuation.price.toLocaleString("en-US")} (${active.valuation.priceDate} US close). Sensitivity to ${active.valuation.fiscalYear} adjusted EPS.`)}</p><table className={styles.valuationTable}><thead><tr><th>{t("利益の前提", "EPS assumption")}</th><th>EPS</th><th>{t("PER", "P/E")}</th></tr></thead><tbody>{[1, 0.8, 0.6].map((factor) => <tr key={factor}><th>{factor === 1 ? t("掲載予想", "Published estimate") : t(`予想から${Math.round((1-factor)*100)}％減`, `${Math.round((1-factor)*100)}% below estimate`)}</th><td>${(active.valuation!.eps*factor).toFixed(2)}</td><td>{(active.valuation!.price/(active.valuation!.eps*factor)).toFixed(2)}{t("倍", "×")}</td></tr>)}</tbody></table><p>{t("20％減・40％減は感応度を見る仮定であり、当方の業績予想ではありません。将来12カ月PERとも異なります。", "The reductions are stress assumptions, not our earnings forecasts. This is fiscal-year P/E, not next-twelve-month P/E.")}</p></section>}
              {active.scenarios && <section className={styles.detailSection}><h3>{t("見立てが分かれる条件", "Conditions that change the thesis")}</h3><div className={styles.scenarios}>{active.scenarios.map((scenario, index) => <div key={index}><h4>{scenario.heading[lang]}</h4><p>{scenario.body[lang]}</p></div>)}</div></section>}
              <section className={styles.detailSection}><h3>{t("まだ分からないこと", "What remains unknown")}</h3><p>{active.unknown[lang]}</p></section>
              <section className={styles.detailSection}><h3><span className={styles.sectionNumber}>03</span>{t("次に確認すること", "What to watch next")}</h3>{active.next[lang].includes("\n") ? <ul className={styles.facts}>{active.next[lang].split("\n").map((point, index) => <li key={index}>{point}</li>)}</ul> : <p>{active.next[lang]}</p>}</section>
              </>}
              {!active.id.startsWith("x-result-") && <div className={styles.sources}><h3>{active.kind === "external-research" ? t("外部調査の原文", "Open external research") : t("根拠資料を開く", "Open supporting sources")}</h3>{active.sources.map((source, i) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><span className={styles.sourceIndex}>{String(i + 1).padStart(2, "0")}</span><span><strong>{source.title}</strong><small>{source.publisher} · {source.publishedOn}</small><small>{source.location}</small></span><Arrow /></a>)}</div>}
              <p className={styles.revision}>{t("資料照合", "Source review")}: {active.reviewedOn} · {active.analysisAsOf ? "v3" : active.analysis ? "v2" : "v1"}<br/>{active.analysisAsOf ? t("株価・外部予想は記載日の固定値。会社実績、外部予想、独自分析を区別しています。", "Price and forecasts are dated snapshots. Company actuals, external forecasts and our analysis are distinguished.") : active.id.startsWith("x-result-") ? t("X投稿の数値を整理しています。会社公式資料との照合前です。", "Reported X-post numbers, pending comparison with the company release.") : active.id.startsWith("ir-result-") ? t("公式発表をもとに独自に整理しています。", "Independently summarised from the company announcement.") : active.id === "mu-q4-2026" ? t("公式決算資料をもとに独自に整理しています。", "Independently summarised from the official earnings release.") : active.kind === "external-research" ? t("公開要約をもとに独自に整理しています。", "Independently researched from the public summary.") : t("発表時点の内容を整理した検証例。以後の変更は自動反映していません。", "A review of the announcement as published. Later changes are not automatically incorporated.")}</p>
              </ResearchNotebook>
            </article>}
          </div>}
          {tab === "saved" && collection.status === "synced" && <SavedSyncStatus collection={collection} lang={lang} />}
        </section>}
        <footer className={styles.footer}><span>TECH PHASE RESEARCH</span><p>{t("変化を読み、一歩先へ。", "Read the shifts. Think ahead.")}</p></footer>
      </main>
    </div>
  </div>;
}

function Empty({ lang, onReset, saved = false }: { lang: Language; onReset: () => void; saved?: boolean }) {
  return <div className={styles.empty}><Bookmark /><h3>{lang === "ja" ? "該当するリサーチがありません" : "No matching research"}</h3><p>{saved ? lang === "ja" ? "記事の保存ボタンを押すと、ここに表示されます。" : "Save a research note to find it here." : lang === "ja" ? "キーワードや絞り込み条件を変更してください。" : "Try another keyword or filter."}</p><button onClick={onReset}>{lang === "ja" ? "検索・絞り込みを解除" : "Clear search and filters"}</button></div>;
}
