"use client";

import { useMemberArticle } from "./use-member-article";
import NavigationIcon from "./navigation-icon";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import MembershipLabel from "./membership-label";
import HeaderPro from "./header-pro";
import HomeLink from "./home-link";
import PageRefresh from "./page-refresh";
import type { Language, ResearchEvent } from "@/lib/research/data";
import { metricNames } from "@/lib/research/data";
import { compareMetrics } from "@/lib/research/quality";
import { valueLabel, dateLabel } from "@/lib/research/presentation";
import { researchViewFromHash, researchViewHashes, type ResearchView } from "@/lib/research/navigation";
import { useResearchLanguage } from "./use-research-language";
import styles from "./research.module.css";
import HomeTools, { HomeHelp } from "./home-tools";
import type { InitialNewsSnapshot } from "@/lib/research/general-news";
import NewsFeed from "./news/news-feed";
import ResearchPulse from "./research-pulse";

const storageKey = "tech-phase:research-saved:v1";
const notifyName = "tech-phase:research-saved";
function subscribeSaved(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(notifyName, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(notifyName, callback); };
}
function savedSnapshot() { try { return localStorage.getItem(storageKey) ?? "[]"; } catch { return "[]"; } }
function useSaved() {
  const snapshot = useSyncExternalStore(subscribeSaved, savedSnapshot, () => "[]");
  return useMemo<string[]>(() => {
    try { const value: unknown = JSON.parse(snapshot); return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []; }
    catch { return []; }
  }, [snapshot]);
}

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
  const [tab, setTab] = useState<ResearchView>("home");
  const [ticker, setTicker] = useState("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(events[0]?.id ?? "");
  const [storageError, setStorageError] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const saved = useSaved();
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;

  useEffect(() => {
    const syncHash = () => {
      const next = researchViewFromHash(window.location.hash);
      if (next) {
        setTab(next);
        const noteId = window.location.hash.startsWith("#what-changed/") ? window.location.hash.slice("#what-changed/".length) : "";
        if (noteId) { setActiveId(noteId); setQuery(""); setTicker("all"); setCategory("all"); }
        if (next === "home") { setQuery(""); setTicker("all"); setCategory("all"); }
      }
    };
    syncHash();
    window.addEventListener("hashchange", syncHash);
    window.addEventListener("popstate", syncHash);
    return () => {
      window.removeEventListener("hashchange", syncHash);
      window.removeEventListener("popstate", syncHash);
    };
  }, []);

  const latestReview = events.map(event => event.reviewedOn).sort().at(-1);
  const filtered = events.filter((event) => {
    const search = [event.ticker, event.company, event.title.ja, event.title.en, event.summary.ja, event.summary.en].join(" ").toLowerCase();
    return (ticker === "all" || event.ticker === ticker) && (category === "all" || event.category === category) &&
      (!query.trim() || search.includes(query.trim().toLowerCase())) && (tab !== "saved" || saved.includes(event.id));
  });
  const selected = filtered.find((event) => event.id === activeId) ?? filtered[0];
  const article = useMemberArticle(selected?.id, Boolean(selected?.locked && (tab === "changes" || tab === "saved")));
  const active = article.event ?? selected;
  const comparisonPeriods = [...new Set(active?.metrics.flatMap((metric) => {
    const previous = active.previous?.find((item) => item.name === metric.name);
    return previous && compareMetrics(metric, previous).ok ? [`${previous.period} → ${metric.period}`] : [];
  }) ?? [])];
  const allMetrics = filtered.flatMap((event) => event.metrics.map((metric) => ({ metric, event })));
  const coveredCompanies = useMemo(() => {
    const companies = new Map<string, { symbol: string; name: string; count: number }>();
    for (const event of events) {
      const current = companies.get(event.ticker);
      companies.set(event.ticker, {
        symbol: event.ticker,
        name: event.company,
        count: (current?.count ?? 0) + 1,
      });
    }
    return [...companies.values()].toSorted((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol));
  }, [events]);
  const companyGroups = useMemo(() => {
    const groups = new Map<string, MonitoredCompany[]>();
    for (const company of monitoredCompanies) {
      const key = company.sector[lang];
      groups.set(key, [...(groups.get(key) ?? []), company]);
    }
    return [...groups.entries()];
  }, [lang, monitoredCompanies]);
  const kinds = { acquisition: t("買収", "Acquisition"), partnership: t("提携", "Partnership"), earnings: t("決算", "Earnings"), capacity: t("設備・電力", "Capacity"), financing: t("資金調達", "Funding"), product: t("製品・料金", "Product & pricing"), "external-research": t("外部調査・評価", "External research") };
  function toggleSaved(id: string) {
    try {
      const next = saved.includes(id) ? saved.filter((value) => value !== id) : [...saved, id];
      localStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(new Event(notifyName));
      setStorageError(false);
    } catch { setStorageError(true); }
  }
  function selectEvent(id: string) {
    setActiveId(id);
    if (tab === "changes") window.history.replaceState(null, "", `#what-changed/${id}`);
    if (window.matchMedia("(max-width: 1150px)").matches) {
      requestAnimationFrame(() => { detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); detailRef.current?.focus({ preventScroll: true }); });
    }
  }
  function clearFilters() { setQuery(""); setTicker("all"); setCategory("all"); }
  function openView(next: ResearchView) {
    const hash = researchViewHashes[next];
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    setTab(next);
    if (next === "home") clearFilters();
    requestAnimationFrame(() => {
      (next === "home" || next === "companies" || next === "pro" || next === "changes" ? document.getElementById("research-main") : workspaceRef.current)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return <div className={styles.app} lang={lang}>
    <a className={styles.skip} href="#research-main">{t("本文へ移動", "Skip to content")}</a>
    <header className={styles.header}>
      <div className={styles.brandGroup}><Link href="/research" className={styles.brand} aria-label="Tech Phase Research">
        <span className={styles.logoMark} aria-hidden="true" /><span><span className={styles.brandText}>TECH PHASE</span><MembershipLabel /></span>
      </Link></div>
      <nav className={`${styles.primaryNav} ${tab === "companies" ? styles.companyNav : ""}`} aria-label={t("メインメニュー", "Main navigation")}>
        <button aria-current={tab === "changes" ? "page" : undefined} onClick={() => openView("changes")}><NavigationIcon name="changes" /><span>{t("何が変わった？", "What changed?")}</span></button>
        <Link href="/research/stocks"><NavigationIcon name="search" /><span>{t("米国株を探す", "Find stocks")}</span></Link>
        <button aria-current={tab === "companies" ? "page" : undefined} onClick={() => openView("companies")}><NavigationIcon name="companies" /><span>{t("監視22銘柄リスト", "22-stock watch list")}</span></button>
        <button aria-current={tab === "metrics" ? "page" : undefined} onClick={() => openView("metrics")}><NavigationIcon name="metrics" /><span>{t("決算・指標", "Financials")}</span></button>
        <button aria-current={tab === "saved" ? "page" : undefined} onClick={() => openView("saved")}><NavigationIcon name="saved" /><span>{t("保存", "Saved")}</span><small>{saved.filter((id) => events.some((event) => event.id === id)).length}</small></button>

      </nav>
      <div className={styles.headerRight}>
        <HomeLink lang={lang} /><PageRefresh lang={lang} /><div className={styles.languages} aria-label={t("言語", "Language")}>
          <button onClick={() => setLang("ja")} aria-pressed={lang === "ja"}>日本語</button>
          <button onClick={() => setLang("en")} aria-pressed={lang === "en"}>EN</button>
        </div>
      <HeaderPro /></div>
    </header>

    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <nav className={styles.sideMenu} aria-label={t("サイドメニュー", "Sidebar navigation")}>
          <p className={styles.navLabel}>{t("メインメニュー", "MAIN MENU")}</p>
          <button aria-current={tab === "changes" ? "page" : undefined} onClick={() => openView("changes")}><NavigationIcon name="changes" /><span>{t("何が変わった？", "What changed?")}</span></button>
          <Link href="/research/stocks"><NavigationIcon name="search" /><span>{t("米国株を探す", "Find stocks")}</span><span aria-hidden="true">↗</span></Link>
          <button aria-current={tab === "companies" ? "page" : undefined} onClick={() => openView("companies")}><NavigationIcon name="companies" /><span>{t("監視22銘柄リスト", "22-stock watch list")}</span><small>{monitoredCompanies.length}</small></button>
          <button aria-current={tab === "metrics" ? "page" : undefined} onClick={() => openView("metrics")}><NavigationIcon name="metrics" /><span>{t("決算・指標", "Financials")}</span></button>
          <button aria-current={tab === "saved" ? "page" : undefined} onClick={() => openView("saved")}><NavigationIcon name="saved" /><span>{t("保存", "Saved")}</span><small>{saved.filter((id) => events.some((event) => event.id === id)).length}</small></button>
          <Link href="/research/compare"><NavigationIcon name="companies" /><span>{t("銘柄比較", "Compare stocks")}</span><small>PRO</small></Link>
          <button className={styles.sideProNav} aria-current={tab === "pro" ? "page" : undefined} onClick={() => openView("pro")}><NavigationIcon name="pro" /><span>Tech Phase PRO</span></button>
        </nav>
        <div className={styles.coverage}>
          <div className={styles.filterHeading}><p className={styles.navLabel}>{t("この一覧の銘柄", "FILTER THESE NOTES")}</p><span>{coveredCompanies.length}</span></div>
          <p className={styles.filterHelp}>{t("この下の検証レポートを絞り込みます。監視対象の全銘柄は「監視22銘柄リスト」から確認できます。", "Filter the research notes below. Open Research coverage for all monitored companies.")}</p>
          {coveredCompanies.map((item) => <button key={item.symbol} aria-pressed={ticker === item.symbol} onClick={() => { setTicker(ticker === item.symbol ? "all" : item.symbol); setCategory("all"); setQuery(""); openView("changes"); }}>
            <span className={styles.miniLogo}>{item.symbol.slice(0, 1)}</span><span><strong>{item.symbol}</strong><small>{item.name}</small></span><span className={styles.coverageCount}>{item.count}</span>
          </button>)}
        </div>
        <Link className={styles.labLink} href="/research/stocks">{t("米国株を検索", "U.S. stock search")} <Arrow /></Link>
        <div className={styles.sideNote}><span className={styles.mono}>SOURCE FIRST</span><p>{t("数字の根拠まで、ひと続きに。", "Follow the evidence behind every number.")}</p></div>
        <Link className={styles.labLink} href="/lab" prefetch={false}>{t("速度測定ラボ", "Delivery lab")} <Arrow /></Link>
      </aside>

      <main id="research-main" className={styles.main}>

        {tab !== "companies" && <div className={styles.heading}><div><p className={styles.eyebrow}>{tab === "home" ? t("ホーム / リサーチデスク", "HOME / THE RESEARCH DESK") : "THE RESEARCH DESK"}</p><h1 id="research-page-title">{tab === "pro" ? "Tech Phase PRO" : tab === "metrics" ? t("数字を、正しく比べる。", "Compare the right numbers.") : tab === "saved" ? t("あとで、深く読む。", "Your research, kept close.") : tab === "changes" ? t("何が変わった？", "What changed?") : t("米国株の変化を、根拠付きで。", "U.S. stock change, backed by evidence.")}</h1>{<p>{tab === "changes" ? t("決算や提携、新サービスなど企業の変化を1ページで。", "Earnings, partnerships, new services and other company changes, all on one page.") : tab === "pro" ? t("変化を読み、一歩先へ。", "Read the shifts. Think ahead.") : t("事実、解釈、次の確認点をひとつの画面に。", "The facts, the interpretation, and what to watch next.")}</p>}</div>{tab !== "pro" && tab !== "home" && <div className={styles.reviewDate}><span>{t("資料照合日", "REVIEWED ON")}</span><strong>{latestReview?.replaceAll("-", ".") ?? "—"}</strong></div>}</div>}

        {tab === "home" && <>
          <ResearchPulse lang={lang} />
          <HomeTools lang={lang} onChanges={() => openView("changes")} onPro={() => openView("pro")} />
          <Link className={styles.watchEntry} href="/research#monitored-companies" onClick={() => openView("companies")}><span><small>COMPANY WATCH</small><strong>{t("監視22銘柄", "22-stock watch")}</strong></span><span>{t("企業ごとの動きを見る", "Follow company changes")} <b aria-hidden="true">›</b></span></Link>
          <NewsFeed lang={lang} initialNews={initialNews} />
          <HomeHelp lang={lang} />
        </>}

        {tab === "companies" && <section id="monitored-companies" className={styles.companyDirectory} aria-labelledby="monitored-companies-title">
          <div className={styles.directoryHead}>
            <div><p className={styles.eyebrow}>OFFICIAL SOURCE WATCH</p><h1 id="monitored-companies-title">{t(`監視${monitoredCompanies.length}銘柄リスト`, `${monitoredCompanies.length} research companies`)}</h1></div>
            <div className={styles.directoryLegend}><span><i className={styles.verifiedDot} aria-hidden="true" />{t("数値比較を公開済み", "Verified comparison")}</span><span><i aria-hidden="true" />{t("取得状況を公開", "Intake status")}</span></div>
          </div>
          <p className={styles.directoryNote}>{t("銘柄を選んで、企業の変化・決算・確認点へ。", "Select a company for developments, earnings and checkpoints.")}</p>
          <div className={styles.companyGroups}>
            {companyGroups.map(([sector, companies]) => <section key={sector} aria-label={sector}>
              <h3>{sector}<span>{companies.length}</span></h3>
              <div>{companies.map((company) => <Link key={company.ticker} href={`/research/companies/${company.ticker}`} aria-label={t(`${company.ticker} ${company.name}の銘柄ページ — ${company.verified ? "数値比較を公開済み" : "取得状況を公開"}`, `${company.ticker} ${company.name} company page — ${company.verified ? "Verified comparison" : "Intake status"}`)}>
                <i className={company.verified ? styles.verifiedDot : undefined} aria-hidden="true" /><strong>{company.ticker}</strong><span>{company.name}</span><b aria-hidden="true">→</b>
              </Link>)}</div>
            </section>)}
          </div>
          <details className={styles.directoryInfo}><summary>{t("掲載状況について", "About coverage")}</summary><p>{t("緑の印は数値を照合したリサーチがある銘柄です。速報配信や全資料の分析完了を示すものではありません。", "Green marks indicate source-checked research, not live delivery or complete analysis of every release.")}</p></details>
        </section>}

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
                t("お気に入り銘柄の登録", "Your stock watchlist"),
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
                <li><strong>{t("リサーチQ&A", "Research Q&A")}</strong>{t("｜会員の疑問を深掘り", " · Member questions explored")}</li>
                <li><strong>{t("リゼルのひとりごと", "RIZEL’s Notes")}</strong>{t("｜相場の着眼点", " · Market perspectives")}</li>
                <li><strong>{t("銘柄比較 PRO", "Stock comparison PRO")}</strong>{t("｜気になる2〜3銘柄を瞬時に判断", " · Assess 2–3 stocks at a glance")}</li>
              </ul>
            </article>
          </div>
        </section>}

        {(tab === "changes" || tab === "metrics" || tab === "saved") && <section id="what-changed" ref={workspaceRef} className={styles.workspace}>
          <span id="metrics" className={styles.anchorTarget} aria-hidden="true" />
          <span id="saved" className={styles.anchorTarget} aria-hidden="true" />
          <div className={styles.toolbar}>
            {tab !== "changes" && <div className={styles.sectionTitle}><h2>{tab === "metrics" ? t("指標一覧", "Metrics") : tab === "saved" ? t("保存した記事", "Saved research") : t("何が変わった？", "What changed?")}</h2><span>{tab === "metrics" ? allMetrics.length : filtered.length}</span></div>}
            <label className={styles.search}><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input aria-label={t("銘柄・キーワードで検索", "Search ticker or keyword")} placeholder={t("銘柄・キーワードを検索", "Search ticker or keyword")} value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          </div>
          <div className={styles.filters}>
            {[{ id: "all", label: t("すべて", "All topics") }, { id: "cloud", label: t("AIクラウド", "AI cloud") }, { id: "memory", label: t("半導体", "Semiconductors") }].map((item) => <button key={item.id} aria-pressed={category === item.id} onClick={() => { setCategory(item.id); setTicker("all"); }}>{item.label}</button>)}
            {ticker !== "all" && <button className={styles.activeTicker} onClick={() => setTicker("all")} aria-label={t(`${ticker}の絞り込みを解除`, `Clear ${ticker} filter`)}>{ticker} ×</button>}
            <span className={styles.sortLabel}>{t("発表日の新しい順", "Newest announcement first")}</span>
          </div>
          {storageError && <p role="alert" className={styles.notice}>{t("このブラウザーでは保存できません。ストレージの設定をご確認ください。", "Saving is unavailable in this browser. Check your storage settings.")}</p>}
          {tab === "saved" && <p className={styles.savedNote}>{t("保存先はこのブラウザーです。アカウント間・端末間の同期は未対応です。", "Saved in this browser only. Account and cross-device sync are not connected.")}</p>}

          {tab === "metrics" ? <div className={styles.tableWrap}>
            {allMetrics.length ? <table><caption>{t("実績・見通し・ARRを区別。金額のMは百万米ドル。", "Actuals, guidance, and run-rate are distinct. M denotes USD millions.")}</caption><thead><tr>{[t("銘柄 / 指標", "Ticker / metric"), t("値", "Value"), t("対象・基準", "Scope / basis"), t("期間", "Period"), t("根拠", "Source")].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{allMetrics.map(({ metric, event }) => <tr key={`${event.id}:${metric.name}`}><th scope="row"><span className={styles.tableTicker}>{event.ticker}</span>{metricNames[metric.name]?.[lang] ?? metric.name}</th><td className={styles.tableValue}>{valueLabel(metric)}</td><td>{metric.scope}<small>{metric.basis} · {metric.kind === "guidance" ? t("会社見通し", "Guidance") : metric.kind === "run-rate" ? t("年換算指標", "Run-rate") : t("実績", "Actual")}</small></td><td>{metric.period}</td><td><a href={event.sources.find((source) => source.id === metric.sourceId)?.url} target="_blank" rel="noreferrer">{t("原文", "Source")} <Arrow /></a></td></tr>)}</tbody></table> : <Empty lang={lang} onReset={clearFilters} />}
          </div> : <div className={styles.researchGrid}>
            <div className={styles.eventList}>
              {filtered.map((event) => <article key={event.id} className={`${styles.eventCard} ${active?.id === event.id ? styles.selected : ""}`}>
                <div className={styles.eventMeta}><span className={styles.ticker}>{event.ticker}</span><span>{kinds[event.kind]}</span><time dateTime={event.publishedOn}>{dateLabel(event.publishedOn, lang)}</time><button className={styles.saveButton} aria-label={saved.includes(event.id) ? t("保存を解除", "Unsave research") : t("リサーチを保存", "Save research")} aria-pressed={saved.includes(event.id)} onClick={() => toggleSaved(event.id)}><Bookmark filled={saved.includes(event.id)} /></button></div>
                <button className={styles.eventOpen} aria-pressed={active?.id === event.id} onClick={() => selectEvent(event.id)}><h3>{event.title[lang]}</h3>{event.id === "mu-q3-2026" && <small>{t("PRO分析の無料サンプル", "Free sample of PRO research")}</small>}<p>{event.summary[lang]}</p><span className={styles.eventFoot}><span>{event.kind === "external-research" ? t("外部調査", "External research") : t("根拠資料", "Sources")} {event.sources.length}<span className={styles.dot}>·</span>{t("原文付き", "Evidence linked")}</span><span>{t("詳しく見る", "Read research")} <span aria-hidden="true">→</span></span></span></button>
              </article>)}
              {!filtered.length && <Empty lang={lang} onReset={clearFilters} saved={tab === "saved"} />}
            </div>

            {active && <article ref={detailRef} tabIndex={-1} className={styles.detail} aria-label={t("リサーチ詳細", "Research detail")}>
              <div className={styles.detailTop}><span className={styles.eyebrow}>RESEARCH NOTE</span><span className={styles.version}>{active.analysisAsOf ? "v3" : active.analysis ? "v2" : "v1"} · {(active.id === "mu-q4-2026" || active.id.startsWith("x-result-")) ? t("決算速報", "Earnings update") : active.id.startsWith("ir-result-") ? t("公式発表", "Company update") : active.analysisAsOf ? t("分析更新", "Updated analysis") : t("過去事例", "Historical")}</span></div>
              <div className={styles.detailCompany}><Link className={styles.detailTicker} href={`/research/companies/${active.ticker}`} aria-label={t(`${active.ticker}の銘柄ページ`, `${active.ticker} company research`)}>{active.ticker} ↗</Link><span>{active.company}</span></div>
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
              {active.valuation && <section className={styles.detailSection}><h3>{t("利益予想が変わると、PERはどう変わるか", "P/E sensitivity to earnings")}</h3><p>{t(`株価 $${active.valuation.price.toLocaleString("en-US")}（${active.valuation.priceDate}米国終値）を固定。${active.valuation.fiscalYear}の調整後EPS予想に対する試算。`, `Price held at $${active.valuation.price.toLocaleString("en-US")} (${active.valuation.priceDate} US close). Sensitivity to ${active.valuation.fiscalYear} adjusted EPS.`)}</p><table className={styles.valuationTable}><thead><tr><th>{t("利益の前提", "EPS assumption")}</th><th>EPS</th><th>PER</th></tr></thead><tbody>{[1, 0.8, 0.6].map((factor) => <tr key={factor}><th>{factor === 1 ? t("掲載予想", "Published estimate") : t(`予想から${Math.round((1-factor)*100)}％減`, `${Math.round((1-factor)*100)}% below estimate`)}</th><td>${(active.valuation!.eps*factor).toFixed(2)}</td><td>{(active.valuation!.price/(active.valuation!.eps*factor)).toFixed(2)}{t("倍", "×")}</td></tr>)}</tbody></table><p>{t("20％減・40％減は感応度を見る仮定であり、当方の業績予想ではありません。将来12カ月PERとも異なります。", "The reductions are stress assumptions, not our earnings forecasts. This is fiscal-year P/E, not next-twelve-month P/E.")}</p></section>}
              {active.scenarios && <section className={styles.detailSection}><h3>{t("見立てが分かれる条件", "Conditions that change the thesis")}</h3><div className={styles.scenarios}>{active.scenarios.map((scenario, index) => <div key={index}><h4>{scenario.heading[lang]}</h4><p>{scenario.body[lang]}</p></div>)}</div></section>}
              <section className={styles.detailSection}><h3>{t("まだ分からないこと", "What remains unknown")}</h3><p>{active.unknown[lang]}</p></section>
              <section className={styles.detailSection}><h3><span className={styles.sectionNumber}>03</span>{t("次に確認すること", "What to watch next")}</h3>{active.next[lang].includes("\n") ? <ul className={styles.facts}>{active.next[lang].split("\n").map((point, index) => <li key={index}>{point}</li>)}</ul> : <p>{active.next[lang]}</p>}</section>
              </>}
              {!active.id.startsWith("x-result-") && <div className={styles.sources}><h3>{active.kind === "external-research" ? t("外部調査の原文", "Open external research") : t("根拠資料を開く", "Open supporting sources")}</h3>{active.sources.map((source, i) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><span className={styles.sourceIndex}>{String(i + 1).padStart(2, "0")}</span><span><strong>{source.title}</strong><small>{source.publisher} · {source.publishedOn}</small><small>{source.location}</small></span><Arrow /></a>)}</div>}
              <p className={styles.revision}>{t("資料照合", "Source review")}: {active.reviewedOn} · {active.analysisAsOf ? "v3" : active.analysis ? "v2" : "v1"}<br/>{active.analysisAsOf ? t("株価・外部予想は記載日の固定値。会社実績、外部予想、独自分析を区別しています。", "Price and forecasts are dated snapshots. Company actuals, external forecasts and our analysis are distinguished.") : active.id.startsWith("x-result-") ? t("X投稿の数値を整理しています。会社公式資料との照合前です。", "Reported X-post numbers, pending comparison with the company release.") : active.id.startsWith("ir-result-") ? t("公式発表をもとに独自に整理しています。", "Independently summarised from the company announcement.") : active.id === "mu-q4-2026" ? t("公式決算資料をもとに独自に整理しています。", "Independently summarised from the official earnings release.") : active.kind === "external-research" ? t("公開要約をもとに独自に整理しています。", "Independently researched from the public summary.") : t("発表時点の内容を整理した検証例。以後の変更は自動反映していません。", "A review of the announcement as published. Later changes are not automatically incorporated.")}</p>
            </article>}
          </div>}
        </section>}
        <footer className={styles.footer}><span>TECH PHASE RESEARCH</span><p>{t("変化を読み、一歩先へ。", "Read the shifts. Think ahead.")}</p></footer>
      </main>
    </div>
  </div>;
}

function Empty({ lang, onReset, saved = false }: { lang: Language; onReset: () => void; saved?: boolean }) {
  return <div className={styles.empty}><Bookmark /><h3>{lang === "ja" ? "該当するリサーチがありません" : "No matching research"}</h3><p>{saved ? lang === "ja" ? "記事の保存ボタンを押すと、ここに表示されます。" : "Save a research note to find it here." : lang === "ja" ? "キーワードや絞り込み条件を変更してください。" : "Try another keyword or filter."}</p><button onClick={onReset}>{lang === "ja" ? "検索・絞り込みを解除" : "Clear search and filters"}</button></div>;
}
