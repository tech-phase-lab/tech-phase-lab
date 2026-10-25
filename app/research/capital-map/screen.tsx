"use client";

import Link from "next/link";
import Image from "next/image";
import { capitalProfiles } from "@/lib/research/capital-map-profiles";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import HoldingDetail from "./holding-detail";
import { capitalRows, etfOverlap, type CapitalPortfolio } from "@/lib/research/capital-map";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { useStockFavorites } from "../use-stock-favorites";
import StockLogo from "../watchlist/stock-logo";
import { useCapitalUpdate } from "./use-capital-preferences";
import styles from "./capital-map.module.css";

const managerMarks: Record<string, { initials: string; tone: string }> = {
  coatue: { initials: "C", tone: "cyan" },
  tiger: { initials: "TG", tone: "amber" },
  viking: { initials: "V", tone: "violet" },
  fundsmith: { initials: "FS", tone: "mint" },
};
const emptyPortfolios: CapitalPortfolio[] = [];
const colors = ["#9875ff", "#ffb52e", "#46b4ff", "#ef69b6", "#28c7bc", "#ff8548", "#8596ff", "#9bce50", "#e6cf70", "#63c6de"];
const sliceColor = (index: number) => colors[index] ?? `hsl(${(index * 137.508) % 360} 65% 65%)`;
const fundNames: Record<string, string> = {
  SPY: "S&P500", ACWI: "全世界株式", SMH: "SMH（半導体）", SOXX: "SOXX（半導体）",
  XLK: "XLK（テクノロジー）", XLF: "XLF（金融）",
};
const stockAliases: Record<string, string> = { "エヌビディア": "NVDA", "アップル": "AAPL", "マイクロソフト": "MSFT", "アマゾン": "AMZN", "グーグル": "GOOGL", "アルファベット": "GOOGL", "マイクロン": "MU", "ネビウス": "NBIS", "テスラ": "TSLA", "ブロードコム": "AVGO" };
const percent = (value: number) => value > 0 && value < .01 ? "<0.01%" : `${value.toFixed(2)}%`;
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
type View = CapitalPortfolio["kind"] | "lookup" | "overlap";

function CapitalMapContent({ portfolios = emptyPortfolios, mode = "sample" }: { portfolios?: CapitalPortfolio[]; mode?: "sample" | "reports" }) {
  const searchParams = useSearchParams();
  const detailId = searchParams.get("holding");
  const detailPortfolio = portfolios.find(p => p.id === searchParams.get("portfolio"));
  const listPosition = useRef<{ y: number; element: HTMLElement; container: HTMLElement | null; top: number } | null>(null);
  const wasDetail = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (detailId) {
        window.scrollTo(0, 0);
        document.querySelector<HTMLElement>("[data-detail-title]")?.focus({ preventScroll: true });
      } else if (wasDetail.current && listPosition.current) {
        if (listPosition.current.container) listPosition.current.container.scrollTop = listPosition.current.top;
        window.scrollTo(0, listPosition.current.y);
        listPosition.current.element.focus({ preventScroll: true });
      }
      wasDetail.current = Boolean(detailId);
    });
    return () => cancelAnimationFrame(frame);
  }, [detailId]);
  const [lang, setLang] = useResearchLanguage();
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const { lists, editable } = useStockFavorites();
  const hasData = portfolios.length > 0;
  const reported = mode === "reports";
  const [view, setView] = useState<View>("manager");
  const [selectedId, setSelectedId] = useState(portfolios[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [activeSlice, setActiveSlice] = useState<number | null>(null);
  const [portraitError, setPortraitError] = useState("");
  const [watchOnly, setWatchOnly] = useState(false);
  const [holdingQuery, setHoldingQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [positionGroup, setPositionGroup] = useState<"current" | "exited">("current");
  const [rowLimit, setRowLimit] = useState(50);
  const [changedOnly, setChangedOnly] = useState(false);
  const etfs = portfolios.filter(item => item.kind === "etf");
  const [leftId, setLeftId] = useState(etfs[0]?.id ?? "");
  const [rightId, setRightId] = useState(etfs.find(item => item.name === "ACWI")?.id ?? etfs[1]?.id ?? "");
  const fundLabel = (item: CapitalPortfolio) => lang === "ja" ? fundNames[item.name] ?? item.name : item.name;
  const isPortfolio = view !== "lookup" && view !== "overlap";
  const visiblePortfolios = portfolios.filter(item => item.kind === view);
  const selected = visiblePortfolios.find(item => item.id === selectedId) ?? visiblePortfolios[0];
  const profile = selected ? capitalProfiles[selected.id.split("-")[0]] : undefined;
  const managerMark = selected ? managerMarks[selected.id.split("-")[0]] : undefined;
  const totalValue = selected?.current.holdings.reduce((sum, row) => sum + row.value, 0) ?? 0;
  const money = (value: number) => new Intl.NumberFormat(lang === "ja" ? "ja-JP" : "en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value);
  const hasValues = totalValue > 0;
  const watched = new Set(lists.flatMap(list => list.tickers));
  const inputTickers = [...new Set(query.toUpperCase().split(/[,、;]+/).map(value => stockAliases[value.trim()] ?? value.trim()).filter(Boolean))];

  const baseline = selected?.previous;
  const hasUpdate = useCapitalUpdate(selected?.id, selected?.current.id, mode);
  const rows = selected ? capitalRows(selected.current, baseline) : [];
  const exitedCount = rows.filter(row => row.change === "exited").length;
  const visibleRows = rows.filter(row => (positionGroup === "exited" ? row.change === "exited" : row.change !== "exited") && (!holdingQuery.trim() || `${row.name} ${row.ticker} ${row.securityId}`.toLowerCase().includes(holdingQuery.trim().toLowerCase())) && (!baseline || !changedOnly || !["unchanged", "unknown"].includes(row.change)));
  const chartLimit = selected?.kind === "etf" ? 30 : 10;
  const top = rows.filter(row => row.weight > 0).slice(0, chartLimit);
  const topWeight = top.reduce((sum, row) => sum + row.weight, 0);
  // Suppress floating-point residue when every holding is already represented.
  const otherWeight = 100 - topWeight > 1e-9 ? 100 - topWeight : 0;
  const slices = [...top.map((row, index) => ({ weight: row.weight, color: sliceColor(index), label: row.ticker || row.name })), ...(otherWeight > 0 ? [{ weight: otherWeight, color: "#536072", label: t("その他", "Other") }] : [])];
  const highlighted = activeSlice === null ? undefined : slices[activeSlice];
  const left = etfs.find(item => item.id === leftId);
  const right = etfs.find(item => item.id === rightId);
  const overlap = left && right && left.id !== right.id ? etfOverlap(left.current, right.current) : null;
  const allHolders = useMemo(() => portfolios.flatMap(item => capitalRows(item.current).filter(row => row.shares > 0 && row.instrument === "stock").map(row => ({ ...row, portfolio: item }))), [portfolios]);
  const knownTickers = new Set(allHolders.map(row => row.ticker));
  const holders = allHolders.filter(row => (!inputTickers.length || inputTickers.some(term => knownTickers.has(term) ? row.ticker === term : row.name.toUpperCase().includes(term))) && (!watchOnly || watched.has(row.ticker))).toSorted((a, b) => b.weight - a.weight);
  const searching = (inputTickers.length > 0 || watchOnly);
  const labels = { new: t("新規保有", "New"), increased: t("保有増加", "Increased"), reduced: t("保有減少", "Reduced"), exited: t("保有解消", "Exited"), unchanged: t("株数変化なし", "Shares unchanged"), unknown: t("—", "—") };
  function choosePortfolio(id: string) { setActiveSlice(null); setSelectedId(id); setHoldingQuery(""); setRowLimit(50); setChangedOnly(false); setPositionGroup("current"); setSearchOpen(false); }
  function chooseView(value: View) { setView(value); choosePortfolio(portfolios.find(item => item.kind === value)?.id ?? ""); }

  function backToList() {
    if (listPosition.current) { window.history.back(); return; }
    if (detailPortfolio) { setView(detailPortfolio.kind); choosePortfolio(detailPortfolio.id); }
    window.history.replaceState(null, "", window.location.pathname);
  }
  const detailBaseline = searchParams.get("baseline") === detailPortfolio?.current.id ? detailPortfolio?.current
    : searchParams.get("baseline") === "unknown" ? undefined : detailPortfolio?.previous;
  return <ResearchToolShell lang={lang} setLang={setLang} title="CAPITAL MAP" description="" showHeading={false} showTools={false}>
    <div className={styles.page}>
      {detailId && hasData && <HoldingDetail portfolio={detailPortfolio} securityId={detailId} instrument={searchParams.get("instrument") ?? "stock"} baseline={detailBaseline} lang={lang} sample={!reported} onBack={backToList} />}
      <div hidden={Boolean(detailId) && hasData}>
      <header className={styles.heading}><p className={styles.eyebrow}>TECH PHASE PRO{!reported && hasData && <span className={styles.edition}>SAMPLE</span>}</p><div className={styles.titleRow}><h1>CAPITAL MAP</h1></div><p>{t("投資先から、資金の流れを知る。", "Follow the holdings. Understand the capital.")}</p></header>
      {!hasData ? <section className={styles.preparing}>
        <h2>{t("世界の運用会社とETFの投資先をひと目で。", "Explore the portfolios behind managers and ETFs.")}</h2>
        <p>{t("保有銘柄と構成比、銘柄ごとの保有先、ETFの重複を確認できます。", "Explore holdings, portfolio weights, stock holders and ETF overlap.")}</p>
        <Link className={styles.primary} href="/research/account">{t("ログイン・プランを確認", "Sign in / View plan")} →</Link> <Link className={styles.primary} href="/research/capital-map/sample">{t("サンプルを見る", "Explore sample")} →</Link>
      </section> : <>
        {!reported && <p className={styles.notice}>{t("架空データの表示サンプルです。", "Display sample using fictional data.")} <Link href="/research/capital-map">{t("実際の保有データを見る", "View reported holdings")} →</Link></p>}
        <div className={styles.navigationRow}><nav className={styles.tabs} aria-label={t("資本マップ", "Capital map")}>
          <button aria-pressed={view === "manager"} onClick={() => chooseView("manager")}>{t("運用会社", "Managers")}</button>
          {portfolios.some(item => item.kind === "corporate") && <button aria-pressed={view === "corporate"} onClick={() => chooseView("corporate")}>{t("企業", "Companies")}</button>}
          {etfs.length > 0 && <button aria-pressed={view === "etf"} onClick={() => chooseView("etf")}>ETF</button>}
        </nav><nav className={styles.tools} aria-label={t("資本マップのツール", "Capital map tools")}><button aria-pressed={view === "lookup"} onClick={() => chooseView("lookup")}>{t("銘柄から検索", "Stock search")}</button>{etfs.length >= 2 && <button aria-pressed={view === "overlap"} onClick={() => chooseView("overlap")}>{t("ETF比較", "ETF compare")}</button>}</nav></div>
        {isPortfolio && <div className={styles.portfolioToolbar}>
          <label className={styles.portfolioSelect}>
            <select aria-label={t("表示する投資先", "Select portfolio")} value={selected?.id ?? ""} onChange={event => choosePortfolio(event.target.value)}>
              {visiblePortfolios.map(item => <option key={item.id} value={item.id}>{item.kind === "etf" ? fundLabel(item) : item.name}</option>)}
            </select>
          </label>
        </div>}
        {view === "lookup" && <section className={styles.find} aria-labelledby="find-holders">
          <h2 id="find-holders">{t("この銘柄を保有する運用会社・ETFを探す", "Find managers and ETFs holding your stock")}</h2>
          <div className={styles.searchBar}><label><span>{t("調べたい銘柄", "Find a stock")}</span><input type="search" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={query} maxLength={200} placeholder={t("例：エヌビディア、NVDA", "e.g. NVIDIA or NVDA")} onChange={event => { setQuery(event.target.value); setRowLimit(50); }} /></label></div>
          <div className={styles.lookupOptions}><label><input type="checkbox" checked={watchOnly} disabled={!editable} onChange={event => { setWatchOnly(event.target.checked); setRowLimit(50); }} />{t("ウォッチリストの銘柄に絞る", "Only stocks in my watchlists")}</label></div>
          {watchOnly && !watched.size && <p className={styles.empty}>{t("ウォッチリストに登録銘柄がありません。", "Your watchlists are empty.")}</p>}
          {searching && <><h3 className={styles.resultCount}>{t("検索結果", "Results")} <span>{holders.length}{t("件", " holders")}</span></h3>
            {holders.length > 0 && <div className={styles.holderHead}><span>{t("保有者", "Holder")}</span><span>{t("保有内の割合", "Portfolio weight")}</span><span>{t("保有評価額", "Holding value")}</span></div>}
            <div className={styles.holderResults}>{holders.slice(0, rowLimit).map(row => <div className={styles.holderRow} key={`${row.portfolio.id}-${row.securityId}-${row.instrument}`}><div><small className={styles.holderKind}>{row.portfolio.kind === "etf" ? "ETF" : row.portfolio.kind === "corporate" ? t("企業", "Company") : t("運用会社", "Manager")}</small><button className={styles.holderLink} onClick={() => { setView(row.portfolio.kind); choosePortfolio(row.portfolio.id); }}>{row.portfolio.kind === "etf" ? fundLabel(row.portfolio) : row.portfolio.name} →</button><small>{row.ticker} · {t(`${row.portfolio.current.asOf}時点`, `As of ${row.portfolio.current.asOf}`)}</small></div><strong>{percent(row.weight)}</strong><span>{row.value > 0 ? money(row.value) : "—"}</span></div>)}</div>
            {!holders.length && <p className={styles.empty}>{t("該当する保有者が見つかりません。企業名やティッカーを変えて検索してください。", "No holders found. Try another company name or ticker.")}</p>}{holders.length > rowLimit && <button className={styles.more} onClick={() => setRowLimit(value => value + 50)}>{t("さらに表示", "Show more")}</button>}</>}
        </section>}
        {selected && isPortfolio && <section className={styles.portfolio} aria-label={selected.name}>
          <div className={styles.identity}>
            {profile ? <><div className={styles.person}>{profile.portrait && portraitError !== selected.id ? <span className={styles.portrait}><Image unoptimized src={profile.portrait.url} alt={t(...profile.person)} width={64} height={64} className={selected.id.startsWith("bridgewater") ? styles.rayPortrait : undefined} onError={() => setPortraitError(selected.id)} /></span> : <span className={styles.managerMark} data-tone={managerMark?.tone ?? "violet"} aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="27" /><path d="M7 32a25 25 0 0 1 25-25M57 32a25 25 0 0 1-25 25" /><path d="M16 49h32M20 53h24" /></svg><span>{managerMark?.initials ?? selected.name.split(" ").slice(0, 2).map(word => word[0]).join("")}</span></span>}<div><strong>{t(...profile.person)}</strong><small>{t(...profile.role)}{profile.leadership && ` · ${t(...profile.leadership)}`}</small></div></div><p>{t(...profile.description)}</p></> : <p>{selected.kind === "etf" ? selected.subtitle : t("企業が公開している株式の保有ポートフォリオ。", "Equity investments disclosed by the company.")}</p>}
          </div>
          <div className={styles.metrics}>
            <div><small>{t("基準日", "AS OF")}{hasUpdate && <span className={styles.updateBadge} title={t("前回開いたときから保有データが更新されました", "Holdings updated since your last visit")}>NEW</span>}</small><strong>{selected.current.asOf}<span>{t("時点", "")}</span></strong></div>
            <div><small>{t("保有銘柄数", "HOLDINGS")}</small><strong>{selected.current.holdings.length.toLocaleString()}<span>{t("銘柄", "holdings")}</span></strong></div>
            <div><small>{t("上位5銘柄の構成比", "TOP 5 WEIGHT")}</small><strong>{percent(top.slice(0, 5).reduce((sum, row) => sum + row.weight, 0))}</strong></div>
          </div>
          <div className={styles.portfolioBody}>
            <div className={styles.chartPanel}>
              <div className={styles.ring} role="group" aria-label={t(`保有構成比。上位${chartLimit}銘柄とその他。`, `Portfolio weights: top ${chartLimit} and other.`)}>
                <svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid meet">
                  <circle cx="200" cy="200" r="148" fill="none" stroke="#536072" strokeWidth="76" />
                  {slices.map((slice, index) => {
                    const start = slices.slice(0, index).reduce((sum, item) => sum + item.weight, 0);
                    const angle = (start + slice.weight / 2) * Math.PI / 50 - Math.PI / 2;
                    const activate = () => setActiveSlice(index);
                    return <g key={index} role="button" tabIndex={0} aria-label={`${slice.label} ${percent(slice.weight)}`} aria-pressed={activeSlice === index} onClick={activate} onMouseEnter={activate} onMouseLeave={() => setActiveSlice(null)} onFocus={activate} onBlur={() => setActiveSlice(null)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } }} className={styles.slice}>
                      <circle cx="200" cy="200" r="148" fill="none" stroke={slice.color} strokeWidth="76" pathLength="100" strokeDasharray={`${Math.max(0, slice.weight - Math.min(.18, slice.weight * .15))} ${100 - Math.max(0, slice.weight - Math.min(.18, slice.weight * .15))}`} strokeDashoffset={-start} transform="rotate(-90 200 200)" />
                      <title>{slice.label}: {percent(slice.weight)}</title>
                      {slice.weight >= 5 ? <text x={200 + 148 * Math.cos(angle)} y={200 + 148 * Math.sin(angle) - 5} textAnchor="middle" className={styles.sliceLabel}><tspan>{slice.label.length > 8 ? slice.label.slice(0, 7) + "…" : slice.label}</tspan><tspan x={200 + 148 * Math.cos(angle)} dy="18">{slice.weight.toFixed(1)}%</tspan></text> : slice.weight >= 1.2 && <text x={200 + 148 * Math.cos(angle)} y={200 + 148 * Math.sin(angle)} textAnchor="middle" dominantBaseline="central" transform={`rotate(${angle * 180 / Math.PI + (Math.cos(angle) < 0 ? 180 : 0)} ${200 + 148 * Math.cos(angle)} ${200 + 148 * Math.sin(angle)})`} className={styles.smallSliceLabel}>{slice.label.length > 6 ? slice.label.slice(0, 5) + "…" : slice.label}</text>}
                    </g>;
                  })}
                </svg>
                <div aria-live="polite">{highlighted ? <><small>{highlighted.label}</small><strong style={{ color: highlighted.color }}>{percent(highlighted.weight)}</strong><small>{activeSlice !== null && top[activeSlice]?.value > 0 ? money(top[activeSlice].value) : t("構成比", "Portfolio weight")}</small></> : <><small>{hasValues ? t("保有評価額の合計", "TOTAL HOLDINGS VALUE") : t("保有構成比", "PORTFOLIO WEIGHT")}</small><strong title={hasValues ? `$${totalValue.toLocaleString("en-US")}` : undefined}>{hasValues ? money(totalValue) : selected.name}</strong><small>{hasValues ? "USD" : t("保有構成比", "PORTFOLIO WEIGHT")}</small></>}</div>
              </div>
              {otherWeight > 0 && <p className={styles.otherKey}><i />{t("その他", "Other")} <strong>{percent(otherWeight)}</strong><span>{t(`上位${chartLimit}銘柄以外`, `Outside the top ${chartLimit}`)}</span></p>}
            </div>
            <div className={styles.tablePanel}>
          <div className={styles.listHead}><div className={styles.positionTabs} aria-label={t("保有状況", "Holding status")}>
            <button aria-pressed={positionGroup === "current"} onClick={() => { setPositionGroup("current"); setRowLimit(50); }}>{t("保有中", "Current")} <span>{selected.current.holdings.length}</span></button>
            {selected.previous && <button aria-pressed={positionGroup === "exited"} onClick={() => { setPositionGroup("exited"); setRowLimit(50); }}>{t("保有解消", "Exited")} <span>{exitedCount}</span></button>}
          </div><button className={styles.searchToggle} aria-label={t("保有一覧を検索", "Search holdings")} aria-expanded={searchOpen} aria-controls="holdings-search" onClick={() => { setSearchOpen(!searchOpen); setHoldingQuery(""); setRowLimit(50); }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg></button></div>
          {searchOpen && <div className={styles.listFilters} id="holdings-search"><input autoFocus type="search" aria-label={t("保有銘柄を絞り込む", "Filter holdings")} placeholder={t("銘柄名・ティッカー", "Company or ticker")} value={holdingQuery} onChange={event => { setHoldingQuery(event.target.value); setRowLimit(50); }} /></div>}
          {selected.previous && <div className={styles.changeHead}><h3>{t("前期からの変化", "Changes since prior period")}<small><time dateTime={selected.previous.asOf}>{selected.previous.asOf}</time><span aria-hidden="true">→</span><time dateTime={selected.current.asOf}>{selected.current.asOf}</time></small></h3><label><input type="checkbox" checked={changedOnly} onChange={event => { setChangedOnly(event.target.checked); setRowLimit(50); }} />{selected.current.holdings.some(row => row.instrument === "bond") ? t("保有数量が変わった銘柄のみ", "Only changed positions") : t("株数が変わった銘柄のみ", "Only changed positions")}</label></div>}
          <div className={styles.positionHead}><span>{t("企業名 / ティッカー", "Company / ticker")}</span><span>{t("構成比", "Weight")}</span><span>{t("保有評価額", "Value")}</span><span>{selected.kind === "etf" ? t("前回比", "Share change") : t("前期比", "Quarter change")}</span></div>
          <div className={styles.holdings} data-holdings>{visibleRows.slice(0, rowLimit).map(row => {
            const colorIndex = top.findIndex(item => item.securityId === row.securityId && item.instrument === row.instrument);
            const detailParams = new URLSearchParams({ portfolio: selected.id, holding: row.securityId, instrument: row.instrument, baseline: baseline?.id ?? "unknown" });
            return <a className={styles.position} key={`${row.securityId}-${row.instrument}`} href={`?${detailParams}`} onClick={event => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              const container = event.currentTarget.closest<HTMLElement>("[data-holdings]");
              listPosition.current = { y: window.scrollY, element: event.currentTarget, container, top: container?.scrollTop ?? 0 };
              window.history.pushState(null, "", `?${detailParams}`);
            }}>
              <div className={styles.positionStock}><span className={styles.positionColor} style={{ background: colorIndex >= 0 ? sliceColor(colorIndex) : "#536072" }} /><StockLogo ticker={row.ticker} /><div className={styles.stock}><strong title={row.name}>{row.name}</strong><small>{row.ticker || `CUSIP ${row.securityId}`}{row.instrument !== "stock" && <b className={styles.option}>{row.instrument.toUpperCase()}</b>}</small></div></div>
              <span className={styles.positionWeight}><strong>{percent(row.weight)}</strong><i style={{ width: `${Math.min(100, row.weight)}%`, background: colorIndex >= 0 ? sliceColor(colorIndex) : "#536072" }} /></span>
              <span className={styles.positionValue} title={hasValues ? `$${row.value.toLocaleString("en-US")}` : t("評価額は未収録", "Value not included")}>{hasValues ? money(row.value) : "—"}</span>
              <span className={styles.positionChange} data-change={row.change} title={row.change === "unknown" ? t("比較できる前回データがありません", "No comparable prior data") : `${row.shares.toLocaleString("en-US")} ${row.instrument === "bond" ? t("USD（元本）", "USD principal") : t("株", "shares")}`}><strong>{row.shareChangePercent === null ? labels[row.change] : signed(row.shareChangePercent)}</strong>{row.shareChangePercent !== null && <small>{labels[row.change]}</small>}</span>
            </a>;
          })}{!visibleRows.length && <p className={styles.empty}>{t("該当する銘柄がありません。", "No matching holdings.")}</p>}</div>
          {!baseline && <p className={styles.missingHistory}>{t("前回比の「—」は比較データ未収録です。", "A dash in Share change means prior data is not yet included.")}</p>}
          {visibleRows.length > rowLimit && <button className={styles.more} onClick={() => setRowLimit(value => value + 50)}>{t("さらに表示", "Show more")} · {Math.min(rowLimit, visibleRows.length)} / {visibleRows.length}</button>}
            </div>
          </div>
          <details className={styles.source} key={selected.id}><summary>{t("データについて", "About this data")}</summary>
            {profile && <p><a href={profile.source} target="_blank" rel="noreferrer">{t("人物・会社紹介の出典", "Profile source")}</a> · {t(`役職確認：${profile.checkedOn ?? "2026-10-12"}`, `Roles checked: ${profile.checkedOn ?? "2026-10-12"}`)}</p>}
            {profile?.portrait && <p>{t("写真", "Photo")}: {profile.portrait.credit} · <a href={profile.portrait.source} target="_blank" rel="noreferrer">Wikimedia Commons</a><a href={profile.portrait.licenseUrl} target="_blank" rel="noreferrer">{profile.portrait.license}</a>{t("（表示枠に合わせてトリミング）", " (cropped to fit)")}</p>}
            {selected.current.source && <><p><a href={selected.current.source.url} target="_blank" rel="noreferrer">{selected.kind === "etf" ? t("運用元の保有明細", "Issuer holdings") : t("SEC保有明細", "SEC holdings")}</a>{selected.kind !== "etf" && <a href={selected.current.source.coverUrl} target="_blank" rel="noreferrer">{t("SEC集計表", "SEC summary")}</a>}</p><p>{t("基準日", "As of")} {selected.current.asOf} · {t("公表日", "Published")} {selected.current.publishedOn}</p></>}
            {selected.previous?.source && <p><a href={selected.previous.source.url} target="_blank" rel="noreferrer">{t("前期のSEC保有明細", "Prior-quarter SEC holdings")}</a> · {selected.previous.asOf}</p>}
            {selected.previous?.source && <p>{t("株数の前回比は開示間の保有株数の変化です。株式分割や合併などによる変化も含まれ、売買量そのものではありません。", "Share change compares reported share counts. It can include splits and mergers and does not represent trading volume.")}</p>}
            <p>{selected.kind === "etf" ? t("構成比は運用元の公表値です。現金・先物等を除いた株式の一覧で、比率の再計算はしていません。", "Weights are published by the issuer. The list contains equities, excluding cash and futures; weights are not renormalized.") : t("構成比は公開13Fの報告評価額に対する割合です。同じ銘柄・株式クラスを集計し、オプションは分けて表示します。現金や開示対象外の資産は含みません。", "Weights use the public 13F reported values. Identical securities and share classes are aggregated; options are separate. Cash and assets outside the filing are excluded.")}</p>
          </details>
        </section>}
        {view === "overlap" && etfs.length >= 2 && <section className={styles.overlap} aria-labelledby="etf-overlap">
          <h2 id="etf-overlap">{t("一緒に持つと、投資先はどれだけ重なる？", "How much would your investments overlap?")}</h2>
          <p className={styles.explainer}>{t("S&P500と全世界株式など、2つの投資先に共通する銘柄を比べられます。", "Compare the stocks shared by investments such as the S&P 500 and global equities.")}</p>
          <div className={styles.compare}><label>{t("投資先 1", "Investment 1")}<select aria-label={t("比較するETF 1", "First ETF")} value={leftId} onChange={event => setLeftId(event.target.value)}>{etfs.map(item => <option key={item.id} value={item.id}>{fundLabel(item)}</option>)}</select></label><span>＋</span><label>{t("投資先 2", "Investment 2")}<select aria-label={t("比較するETF 2", "Second ETF")} value={rightId} onChange={event => setRightId(event.target.value)}>{etfs.map(item => <option key={item.id} value={item.id}>{fundLabel(item)}</option>)}</select></label></div>
          {(left?.name === "ACWI" || right?.name === "ACWI") && <p className={styles.comparisonScope}>{t("全世界株式は米国ETF「ACWI」の保有データです。国内投信の「オルカン」そのものではありません。", "Global equities use the US-listed ACWI ETF, not a Japanese mutual fund.")}</p>}
          <p className={styles.footnote}>{left?.name} {t(`${left?.current.asOf}時点`, `As of ${left?.current.asOf}`)} · {right?.name} {t(`${right?.current.asOf}時点`, `As of ${right?.current.asOf}`)}</p>
          {!overlap ? <p className={styles.empty}>{t("異なるETFを選んでください。", "Choose two different ETFs.")}</p> : <>
            <div className={styles.overlapResult}><div><small>{t("共通する銘柄", "Shared stocks")}</small><strong>{overlap.rows.length}<small>{t("銘柄", "stocks")}</small></strong></div><div><small>{t("同じ銘柄への配分が重なる割合", "Overlapping portfolio allocation")}</small><strong>{percent(overlap.percent)}</strong></div></div>
            <div className={styles.overlapBar}><span style={{ width: `${overlap.percent}%` }} /></div>
            {overlap.rows[0] && <p className={styles.overlapExample}>{t(`例えば${overlap.rows[0].ticker || overlap.rows[0].name}は、${left?.name}に${percent(overlap.rows[0].left)}、${right?.name}に${percent(overlap.rows[0].right)}。小さい方の${percent(overlap.rows[0].shared)}が共通する配分です。`, `For example, ${overlap.rows[0].ticker || overlap.rows[0].name} is ${percent(overlap.rows[0].left)} of ${left?.name} and ${percent(overlap.rows[0].right)} of ${right?.name}. The smaller weight, ${percent(overlap.rows[0].shared)}, is the shared allocation.`)}</p>}
            <div className={styles.sharedHead}><span>{t("両方に入っている銘柄", "Stocks held by both")}</span><span>{left?.name}</span><span>{right?.name}</span></div>
            <div className={styles.sharedRows}>{overlap.rows.map((row, index) => <div key={`${row.ticker}-${row.name}-${index}`}><div><strong>{row.ticker || row.name}</strong>{row.ticker && <small>{row.name}</small>}</div><span>{percent(row.left)}<i style={{ width: `${row.left}%` }} /></span><span>{percent(row.right)}<i style={{ width: `${row.right}%` }} /></span></div>)}</div>
            <details className={styles.source}><summary>{t("計算方法", "Method")}</summary><p>{t("共通する株式ごとに小さい方の構成比を合計します。株式クラスが違う場合は別銘柄として扱います。現金・先物等は含みません。", "We sum the smaller weight for each shared equity. Different share classes are treated separately. Cash and futures are excluded.")}</p></details>
          </>}
        </section>}
        <details className={styles.usage}><summary>{t("使い方", "How to use")}</summary><p>{t("NEWは前回開いたときから保有データが更新された場合に表示します。検索は収録対象の公開保有情報を参照します。", "NEW indicates holdings updated since your last visit in this browser. Search covers the public holdings included in Capital Map.")}</p></details>
      </>}
      </div>
    </div>
  </ResearchToolShell>;
}

export default function CapitalMap(props: { portfolios?: CapitalPortfolio[]; mode?: "sample" | "reports" }) {
  return <Suspense fallback={<p>CAPITAL MAP</p>}><CapitalMapContent {...props} /></Suspense>;
}
