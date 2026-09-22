"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { Language, ResearchEvent } from "@/lib/research/data";
import { metricNames } from "@/lib/research/data";
import { compareMetrics } from "@/lib/research/quality";
import { valueLabel, dateLabel } from "@/lib/research/presentation";
import { researchViewFromHash, researchViewHashes, type ResearchView } from "@/lib/research/navigation";
import { useResearchLanguage } from "./use-research-language";
import styles from "./research.module.css";
import HomeTools from "./home-tools";

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

export default function ResearchDashboard({ events, monitoredCompanies }: { events: ResearchEvent[]; monitoredCompanies: MonitoredCompany[] }) {
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

  const filtered = events.filter((event) => {
    const search = [event.ticker, event.company, event.title.ja, event.title.en, event.summary.ja, event.summary.en].join(" ").toLowerCase();
    return (ticker === "all" || event.ticker === ticker) && (category === "all" || event.category === category) &&
      (!query.trim() || search.includes(query.trim().toLowerCase())) && (tab !== "saved" || saved.includes(event.id));
  });
  const active = filtered.find((event) => event.id === activeId) ?? filtered[0];
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
  const kinds = { partnership: t("提携", "Partnership"), earnings: t("決算", "Earnings"), capacity: t("設備・電力", "Capacity"), financing: t("資金調達", "Funding"), product: t("製品・料金", "Product & pricing") };
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
    if (window.matchMedia("(max-width: 1150px)").matches) {
      requestAnimationFrame(() => { detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); detailRef.current?.focus({ preventScroll: true }); });
    }
  }
  function clearFilters() { setQuery(""); setTicker("all"); setCategory("all"); }
  function openView(next: ResearchView) {
    const hash = researchViewHashes[next];
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    setTab(next);
    if (next === "home") clearFilters();
    requestAnimationFrame(() => {
      (next === "home" ? document.getElementById("research-main") : workspaceRef.current)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return <div className={styles.app} lang={lang}>
    <a className={styles.skip} href="#research-main">{t("本文へ移動", "Skip to content")}</a>
    <header className={styles.header}>
      <Link href="/research" className={styles.brand} aria-label="Tech Phase Research">
        <span className={styles.mark}>TP<span /></span><span>TECH PHASE<small>RESEARCH</small></span>
      </Link>
      <nav className={styles.primaryNav} aria-label={t("メインメニュー", "Main navigation")}>
        <button aria-current={tab === "home" ? "page" : undefined} onClick={() => openView("home")}>{t("ホーム", "Home")}</button>
        <button aria-current={tab === "changes" ? "page" : undefined} onClick={() => openView("changes")}>{t("何が変わった？", "What changed?")}</button>
        <Link href="/research/stocks">{t("米国株を探す", "Find stocks")}</Link>
        <a href="#monitored-companies">{t("監視対象", "Company watch")}</a>
        <button aria-current={tab === "metrics" ? "page" : undefined} onClick={() => openView("metrics")}>{t("決算・指標", "Financials")}</button>
        <button aria-current={tab === "saved" ? "page" : undefined} onClick={() => openView("saved")}>{t("保存", "Saved")}<small>{saved.filter((id) => events.some((event) => event.id === id)).length}</small></button>
        <a className={styles.proNav} href="#tech-phase-pro">Tech Phase PRO</a>
      </nav>
      <div className={styles.headerRight}>
        <span className={styles.edition}>RESEARCH PREVIEW <span>02</span></span>
        <div className={styles.languages} aria-label={t("言語", "Language")}>
          <button onClick={() => setLang("ja")} aria-pressed={lang === "ja"}>日本語</button>
          <button onClick={() => setLang("en")} aria-pressed={lang === "en"}>EN</button>
        </div>
      </div>
    </header>

    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <nav className={styles.sideMenu} aria-label={t("サイドメニュー", "Sidebar navigation")}>
          <p className={styles.navLabel}>{t("メインメニュー", "MAIN MENU")}</p>
          <button aria-current={tab === "home" ? "page" : undefined} onClick={() => openView("home")}>{t("ホーム", "Home")}</button>
          <button aria-current={tab === "changes" ? "page" : undefined} onClick={() => openView("changes")}>{t("何が変わった？", "What changed?")}</button>
          <Link href="/research/stocks">{t("米国株を探す", "Find stocks")}<span aria-hidden="true">↗</span></Link>
          <a href="#monitored-companies">{t("監視対象", "Company watch")}<small>{monitoredCompanies.length}</small></a>
          <button aria-current={tab === "metrics" ? "page" : undefined} onClick={() => openView("metrics")}>{t("決算・指標", "Financials")}</button>
          <button aria-current={tab === "saved" ? "page" : undefined} onClick={() => openView("saved")}>{t("保存", "Saved")}<small>{saved.filter((id) => events.some((event) => event.id === id)).length}</small></button>
          <a className={styles.sideProNav} href="#tech-phase-pro">Tech Phase PRO</a>
        </nav>
        <div className={styles.coverage}>
          <div className={styles.filterHeading}><p className={styles.navLabel}>{t("この一覧の銘柄", "FILTER THESE NOTES")}</p><span>{coveredCompanies.length}</span></div>
          <p className={styles.filterHelp}>{t("この下の検証レポートを絞り込みます。監視対象の全銘柄は「監視対象」から確認できます。", "Filter the research notes below. Open Company watch for all monitored companies.")}</p>
          {coveredCompanies.map((item) => <button key={item.symbol} aria-pressed={ticker === item.symbol} onClick={() => { setTicker(ticker === item.symbol ? "all" : item.symbol); setCategory("all"); setQuery(""); openView("changes"); }}>
            <span className={styles.miniLogo}>{item.symbol.slice(0, 1)}</span><span><strong>{item.symbol}</strong><small>{item.name}</small></span><span className={styles.coverageCount}>{item.count}</span>
          </button>)}
        </div>
        <Link className={styles.labLink} href="/research/stocks">{t("米国株を検索", "U.S. stock search")} <Arrow /></Link>
        <div className={styles.sideNote}><span className={styles.mono}>SOURCE FIRST</span><p>{t("数字の根拠まで、ひと続きに。", "Follow the evidence behind every number.")}</p></div>
        <Link className={styles.labLink} href="/lab" prefetch={false}>{t("速度測定ラボ", "Delivery lab")} <Arrow /></Link>
      </aside>

      <main id="research-main" className={styles.main}>
        <div className={styles.previewNotice}><span>{t("検証版", "PREVIEW")}</span><p>{t("2026年5〜9月の公式発表を使った過去事例です。公式発表の自動監視は運営環境で検証中ですが、この画面の自動更新と会員配信はまだ開始していません。", "Historical examples from May–September 2026. Official-source monitoring is being tested in operations, while automatic updates and member delivery remain off on this screen.")}</p></div>

        <div className={styles.heading}><div><p className={styles.eyebrow}>{tab === "home" ? t("ホーム / リサーチデスク", "HOME / THE RESEARCH DESK") : "THE RESEARCH DESK"}</p><h1>{tab === "metrics" ? t("数字を、正しく比べる。", "Compare the right numbers.") : tab === "saved" ? t("あとで、深く読む。", "Your research, kept close.") : tab === "changes" ? t("何が変わった？を、根拠付きで。", "See what changed. Follow the evidence.") : t("米国株の変化を、根拠付きで。", "U.S. stock change, backed by evidence.")}</h1><p>{t("事実、解釈、次の確認点をひとつの画面に。", "The facts, the interpretation, and what to watch next.")}</p></div><div className={styles.reviewDate}><span>{t("資料照合日", "REVIEWED ON")}</span><strong>2026.09.19</strong></div></div>

        <HomeTools lang={lang} onChanges={() => openView("changes")} />

        <section id="monitored-companies" className={styles.companyDirectory} aria-labelledby="monitored-companies-title">
          <div className={styles.directoryHead}>
            <div><p className={styles.eyebrow}>OFFICIAL SOURCE WATCH</p><h2 id="monitored-companies-title">{t(`監視対象 ${monitoredCompanies.length}社`, `${monitoredCompanies.length} monitored companies`)}</h2></div>
            <div className={styles.directoryLegend}><span><i className={styles.verifiedDot} aria-hidden="true" />{t("数値比較を公開済み", "Verified comparison")}</span><span><i aria-hidden="true" />{t("取得状況を公開", "Intake status")}</span></div>
          </div>
          <p className={styles.directoryNote}>{t("公式発表の取得対象です。緑の印は、原文と数値を照合した「何が変わった？」を公開済みの銘柄です。速報配信や全資料の分析完了を示すものではありません。", "These companies are monitored through official sources. A green marker means a source-checked What changed? comparison is published; it does not indicate live delivery or complete analysis of every release.")}</p>
          <div className={styles.companyGroups}>
            {companyGroups.map(([sector, companies]) => <section key={sector} aria-label={sector}>
              <h3>{sector}<span>{companies.length}</span></h3>
              <div>{companies.map((company) => <Link key={company.ticker} href={`/research/companies/${company.ticker}`} aria-label={t(`${company.ticker} ${company.name}の銘柄ページ — ${company.verified ? "数値比較を公開済み" : "取得状況を公開"}`, `${company.ticker} ${company.name} company page — ${company.verified ? "Verified comparison" : "Intake status"}`)}>
                <i className={company.verified ? styles.verifiedDot : undefined} aria-hidden="true" /><strong>{company.ticker}</strong><span>{company.name}</span><b aria-hidden="true">→</b>
              </Link>)}</div>
            </section>)}
          </div>
        </section>

        <section id="tech-phase-pro" className={styles.accessMatrix} aria-labelledby="access-matrix-title">
          <div className={styles.accessHead}>
            <div><p className={styles.eyebrow}>FREE / TECH PHASE PRO</p><h2 id="access-matrix-title">{t("無料で調べる。PROなら変化を見逃さない。", "Research for free. Stay ahead of change with PRO.")}</h2></div>
            <p>{t("課金・会員公開は未開始。現在の実装と提供予定を混ぜずに表示しています。", "Billing and member access are not live. Current features and planned PRO features are labeled separately.")}</p>
          </div>
          <div className={styles.accessCards}>
            <article className={styles.accessCard}>
              <div className={styles.accessStatus}><span>FREE</span><em>{t("現在利用可能", "Available now")}</em></div>
              <h3>{t("一次情報を自分で確認", "Verify the primary source")}</h3>
              <ul>
                <li>{t("米国株検索とSEC企業情報", "U.S. stock search and SEC company data")}</li>
                <li>{t("TradingViewの参考株価・12か月チャート", "TradingView reference quotes and 12-month chart")}</li>
                <li>{t("公開済みリサーチと公式原文リンク", "Published research with primary-source links")}</li>
              </ul>
              <Link href="/research/stocks">{t("米国株を検索する", "Search U.S. stocks")} <Arrow /></Link>
            </article>
            <article className={`${styles.accessCard} ${styles.proCard}`}>
              <div className={styles.accessStatus}><span>TECH PHASE PRO</span><em>{t("提供準備中", "In development")}</em></div>
              <h3>{t("重要な変化を短時間で把握", "Understand material change quickly")}</h3>
              <ul>
                <li>{t("公式発表を検知した事実速報", "Fact-first alerts from official releases")}</li>
                <li>{t("原文照合済みの日本語要点・影響分類", "Source-checked Japanese briefs and impact labels")}</li>
                <li>{t("WHAT CHANGED履歴と優先銘柄の監視", "WHAT CHANGED history and priority-company monitoring")}</li>
              </ul>
              <p className={styles.accessNote}>{t("速度・対象範囲は実測後に確定。未承認の要約、契約未確認のニュースや価格は配信しません。", "Speed and coverage will be set only after measurement. Unapproved briefs and unlicensed news or price data will not be delivered.")}</p>
            </article>
          </div>
        </section>

        <section id="what-changed" ref={workspaceRef} className={styles.workspace}>
          <span id="metrics" className={styles.anchorTarget} aria-hidden="true" />
          <span id="saved" className={styles.anchorTarget} aria-hidden="true" />
          <div className={styles.toolbar}>
            <div className={styles.sectionTitle}><h2>{tab === "metrics" ? t("指標一覧", "Metrics") : tab === "saved" ? t("保存した記事", "Saved research") : tab === "home" ? t("最新の「何が変わった？」", "Latest: What changed?") : t("何が変わった？", "What changed?")}</h2><span>{tab === "metrics" ? allMetrics.length : filtered.length}</span></div>
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
                <button className={styles.eventOpen} aria-pressed={active?.id === event.id} onClick={() => selectEvent(event.id)}><h3>{event.title[lang]}</h3><p>{event.summary[lang]}</p><span className={styles.eventFoot}><span>{t("一次資料", "Primary sources")} {event.sources.length}<span className={styles.dot}>·</span>{t("原文付き", "Evidence linked")}</span><span>{t("詳しく見る", "Read research")} <span aria-hidden="true">→</span></span></span></button>
              </article>)}
              {!filtered.length && <Empty lang={lang} onReset={clearFilters} saved={tab === "saved"} />}
            </div>

            {active && <article ref={detailRef} tabIndex={-1} className={styles.detail} aria-label={t("リサーチ詳細", "Research detail")}>
              <div className={styles.detailTop}><span className={styles.eyebrow}>RESEARCH NOTE</span><span className={styles.version}>v1 · {t("過去事例", "Historical")}</span></div>
              <div className={styles.detailCompany}><Link className={styles.detailTicker} href={`/research/companies/${active.ticker}`} aria-label={t(`${active.ticker}の銘柄ページ`, `${active.ticker} company research`)}>{active.ticker} ↗</Link><span>{active.company}</span></div>
              <h2>{active.title[lang]}</h2>
              <div className={styles.change}><span>{t("今回の変化", "WHAT CHANGED")}</span><p>{active.change[lang]}</p></div>
              {active.metrics.length > 0 && <div className={styles.metricStrip}>{active.metrics.slice(0, 2).map((metric) => {
                const previous = active.previous?.find((item) => item.name === metric.name);
                const comparison = previous && compareMetrics(metric, previous);
                return <div key={metric.name}><span>{metricNames[metric.name]?.[lang] ?? metric.name}</span><strong>{valueLabel(metric)}</strong><small>{metric.period} · {metric.basis}</small><small>{metric.kind === "guidance" ? t("会社見通し", "Guidance") : metric.kind === "run-rate" ? t("年換算・売上実績とは別", "Annualized run-rate, not actual revenue") : metric.scope}</small>{comparison?.ok && <b>{comparison.value >= 0 ? "+" : ""}{comparison.value.toFixed(1)}{comparison.unit === "pp" ? t("pt", "pp") : "%"}<em>{previous?.period} {t("比", "comparison")}</em></b>}</div>;
              })}</div>}
              <section className={styles.detailSection}><h3><span className={styles.sectionNumber}>01</span>{t("発表で確認できる事実", "What the source says")}</h3><ul className={styles.facts}>{active.facts.map((fact, index) => <li key={index}>{fact.text[lang]} {fact.sourceIds.map((id) => <a key={id} href={active.sources.find((source) => source.id === id)?.url} target="_blank" rel="noreferrer" aria-label={t(`根拠資料${active.sources.findIndex((source) => source.id === id) + 1}を開く`, `Open source ${active.sources.findIndex((source) => source.id === id) + 1}`)}>[{active.sources.findIndex((source) => source.id === id) + 1}]</a>)}</li>)}</ul></section>
              <section className={styles.detailSection}><h3><span className={styles.sectionNumber}>02</span>{t("どう読むか", "How to read it")}<small>{t("分析・解釈", "INTERPRETATION")}</small></h3><p>{active.interpretation[lang]}</p></section>
              <section className={`${styles.detailSection} ${styles.unknown}`}><h3>{t("まだ分からないこと", "What remains unknown")}</h3><p>{active.unknown[lang]}</p></section>
              <section className={styles.detailSection}><h3><span className={styles.sectionNumber}>03</span>{t("次に確認すること", "What to watch next")}</h3><p>{active.next[lang]}</p></section>
              <div className={styles.sources}><h3>{t("一次資料を開く", "Open primary sources")}</h3>{active.sources.map((source, i) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><span className={styles.sourceIndex}>{String(i + 1).padStart(2, "0")}</span><span><strong>{source.title}</strong><small>{source.publisher} · {source.publishedOn}</small><small>{source.location}</small></span><Arrow /></a>)}</div>
              <p className={styles.revision}>{t("資料照合", "Source review")}: {active.reviewedOn} · v1<br/>{t("発表時点の内容を整理した検証例。以後の変更は自動反映していません。", "A review of the announcement as published. Later changes are not automatically incorporated.")}</p>
            </article>}
          </div>}
        </section>
        <footer className={styles.footer}><span>TECH PHASE RESEARCH</span><p>{t("公式発表に基づく検証用リサーチ。自動監視は運営検証中、会員配信・課金・外部通知は停止したままです。", "A source-linked research preview. Monitoring is under operational review; member delivery, billing, and external notifications remain off.")}</p></footer>
      </main>
    </div>
  </div>;
}

function Empty({ lang, onReset, saved = false }: { lang: Language; onReset: () => void; saved?: boolean }) {
  return <div className={styles.empty}><Bookmark /><h3>{lang === "ja" ? "該当するリサーチがありません" : "No matching research"}</h3><p>{saved ? lang === "ja" ? "記事の保存ボタンを押すと、ここに表示されます。" : "Save a research note to find it here." : lang === "ja" ? "キーワードや絞り込み条件を変更してください。" : "Try another keyword or filter."}</p><button onClick={onReset}>{lang === "ja" ? "検索・絞り込みを解除" : "Clear search and filters"}</button></div>;
}
