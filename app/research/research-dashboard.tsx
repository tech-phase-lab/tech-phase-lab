"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { Language, ResearchEvent } from "@/lib/research/data";
import { metricNames } from "@/lib/research/data";
import { compareMetrics, type Metric } from "@/lib/research/quality";
import styles from "./research.module.css";

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
function valueLabel(metric: Metric) {
  if (metric.unit === "percent") return `${metric.value.toFixed(1)}%`;
  if (metric.unit === "GW") return `${metric.value} GW`;
  if (metric.unit === "million") return `${metric.value < 0 ? "-" : ""}$${Math.abs(metric.value).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
  return `$${metric.value.toFixed(2)}`;
}
function dateLabel(value: string, lang: Language) {
  return new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export default function ResearchDashboard({ events }: { events: ResearchEvent[] }) {
  const [lang, setLang] = useState<Language>("ja");
  const [tab, setTab] = useState<"changes" | "metrics" | "saved">("changes");
  const [ticker, setTicker] = useState("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(events[0].id);
  const [storageError, setStorageError] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const saved = useSaved();
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  useEffect(() => { const before = document.documentElement.lang; document.documentElement.lang = lang; return () => { document.documentElement.lang = before; }; }, [lang]);

  const filtered = events.filter((event) => {
    const search = [event.ticker, event.company, event.title.ja, event.title.en, event.summary.ja, event.summary.en].join(" ").toLowerCase();
    return (ticker === "all" || event.ticker === ticker) && (category === "all" || event.category === category) &&
      (!query.trim() || search.includes(query.trim().toLowerCase())) && (tab !== "saved" || saved.includes(event.id));
  });
  const active = filtered.find((event) => event.id === activeId) ?? filtered[0];
  const allMetrics = filtered.flatMap((event) => event.metrics.map((metric) => ({ metric, event })));
  const kinds = { partnership: t("提携", "Partnership"), earnings: t("決算", "Earnings"), capacity: t("設備・電力", "Capacity") };
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

  return <div className={styles.app} lang={lang}>
    <a className={styles.skip} href="#research-main">{t("本文へ移動", "Skip to content")}</a>
    <header className={styles.header}>
      <Link href="/research" className={styles.brand} aria-label="Tech Phase Research">
        <span className={styles.mark}>TP<span /></span><span>TECH PHASE<small>RESEARCH</small></span>
      </Link>
      <div className={styles.headerRight}>
        <span className={styles.edition}>RESEARCH PREVIEW <span>01</span></span>
        <div className={styles.languages} aria-label={t("言語", "Language")}>
          <button onClick={() => setLang("ja")} aria-pressed={lang === "ja"}>日本語</button>
          <button onClick={() => setLang("en")} aria-pressed={lang === "en"}>EN</button>
        </div>
      </div>
    </header>

    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <p className={styles.navLabel}>WORKSPACE</p>
        <nav aria-label={t("リサーチメニュー", "Research navigation")}>
          <button aria-current={tab === "changes" ? "page" : undefined} onClick={() => setTab("changes")}><span aria-hidden="true">▤</span>{t("変化を追う", "What changed")}</button>
          <button aria-current={tab === "metrics" ? "page" : undefined} onClick={() => setTab("metrics")}><span aria-hidden="true">▥</span>{t("決算・指標", "Financial metrics")}</button>
          <button aria-current={tab === "saved" ? "page" : undefined} onClick={() => setTab("saved")}><Bookmark />{t("保存したリサーチ", "Saved research")}<small>{saved.filter((id) => events.some((event) => event.id === id)).length}</small></button>
        </nav>
        <div className={styles.coverage}>
          <p className={styles.navLabel}>{t("今回の検証対象", "IN THIS REVIEW")}</p>
          {[{ symbol: "NBIS", name: "Nebius" }, { symbol: "MU", name: "Micron" }].map((item) => <button key={item.symbol} aria-pressed={ticker === item.symbol} onClick={() => { setTicker(ticker === item.symbol ? "all" : item.symbol); setCategory("all"); }}>
            <span className={styles.miniLogo}>{item.symbol.slice(0, 1)}</span><span><strong>{item.symbol}</strong><small>{item.name}</small></span><span className={styles.coverageCount}>{events.filter((event) => event.ticker === item.symbol).length}</span>
          </button>)}
        </div>
        <div className={styles.sideNote}><span className={styles.mono}>SOURCE FIRST</span><p>{t("数字の根拠まで、ひと続きに。", "Follow the evidence behind every number.")}</p></div>
        <Link className={styles.labLink} href="/" prefetch={false}>{t("速度測定ラボ", "Delivery lab")} <Arrow /></Link>
      </aside>

      <main id="research-main" className={styles.main}>
        <div className={styles.previewNotice}><span>{t("検証版", "PREVIEW")}</span><p>{t("2026年6〜9月の公式発表を使った過去事例です。自動更新・リアルタイム配信は未接続。", "Historical examples from June–September 2026. Automatic updates and live delivery are not connected.")}</p></div>

        <div className={styles.heading}><div><p className={styles.eyebrow}>THE RESEARCH DESK</p><h1>{tab === "metrics" ? t("数字を、正しく比べる。", "Compare the right numbers.") : tab === "saved" ? t("あとで、深く読む。", "Your research, kept close.") : t("変化を捉え、根拠まで。", "See the change. Follow the evidence.")}</h1><p>{t("事実、解釈、次の確認点をひとつの画面に。", "The facts, the interpretation, and what to watch next.")}</p></div><div className={styles.reviewDate}><span>{t("資料照合日", "REVIEWED ON")}</span><strong>2026.09.19</strong></div></div>

        <section className={styles.overview} aria-label={t("検証内容", "Review overview")}>
          <div><span className={styles.cardLabel}>{t("検証レポート", "RESEARCH NOTES")}</span><strong>04<span>{t("件", "notes")}</span></strong><p>{t("公式発表にリンク", "Linked to primary sources")}</p></div>
          <div><span className={styles.cardLabel}>{t("対象銘柄", "COMPANIES")}</span><strong>02<span>MU / NBIS</span></strong><p>{t("半導体・AIクラウド", "Memory & AI cloud")}</p></div>
          <div className={styles.quoteStatus}><span className={styles.cardLabel}>{t("株価データ", "MARKET DATA")}</span><strong>—<span>{t("配信準備中", "Not connected")}</span></strong><p>{t("契約確認後に価格と遅延を表示", "Prices and feed delay follow licensing")}</p></div>
        </section>

        <section className={styles.workspace}>
          <div className={styles.toolbar}>
            <div className={styles.sectionTitle}><h2>{tab === "metrics" ? t("指標一覧", "Metrics") : tab === "saved" ? t("保存したリサーチ", "Saved research") : "WHAT CHANGED?"}</h2><span>{tab === "metrics" ? allMetrics.length : filtered.length}</span></div>
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
              <div className={styles.detailCompany}><span className={styles.detailTicker}>{active.ticker}</span><span>{active.company}</span></div>
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
        <footer className={styles.footer}><span>TECH PHASE RESEARCH</span><p>{t("公式発表に基づく検証用リサーチ。速報・会員課金・自動監視は未接続です。", "A source-linked research preview. Live news, billing, and automated monitoring are not connected.")}</p></footer>
      </main>
    </div>
  </div>;
}

function Empty({ lang, onReset, saved = false }: { lang: Language; onReset: () => void; saved?: boolean }) {
  return <div className={styles.empty}><Bookmark /><h3>{lang === "ja" ? "該当するリサーチがありません" : "No matching research"}</h3><p>{saved ? lang === "ja" ? "記事の保存ボタンを押すと、ここに表示されます。" : "Save a research note to find it here." : lang === "ja" ? "キーワードや絞り込み条件を変更してください。" : "Try another keyword or filter."}</p><button onClick={onReset}>{lang === "ja" ? "検索・絞り込みを解除" : "Clear search and filters"}</button></div>;
}
