"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { capitalRows, etfOverlap, type CapitalPortfolio } from "@/lib/research/capital-map";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { useStockFavorites } from "../use-stock-favorites";
import StockLogo from "../watchlist/stock-logo";
import { useCapitalPreferences } from "./use-capital-preferences";
import styles from "./capital-map.module.css";

const emptyPortfolios: CapitalPortfolio[] = [];
const colors = ["#88d9bc", "#78b5e1", "#a59cde", "#dda88b", "#7bc9cb"];
const percent = (value: number) => value > 0 && value < .01 ? "<0.01%" : `${value.toFixed(2)}%`;
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
type View = CapitalPortfolio["kind"] | "lookup" | "overlap";

export default function CapitalMap({ portfolios = emptyPortfolios, mode = "sample" }: { portfolios?: CapitalPortfolio[]; mode?: "sample" | "reports" }) {
  const [lang, setLang] = useResearchLanguage();
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const { lists, editable } = useStockFavorites();
  const hasData = portfolios.length > 0;
  const reported = mode === "reports";
  const [view, setView] = useState<View>("manager");
  const [selectedId, setSelectedId] = useState(portfolios[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [watchOnly, setWatchOnly] = useState(false);
  const [holdingQuery, setHoldingQuery] = useState("");
  const [rowLimit, setRowLimit] = useState(50);
  const [comparison, setComparison] = useState<"period" | "visit">("period");
  const [changedOnly, setChangedOnly] = useState(false);
  const [message, setMessage] = useState("");
  const { saved, seen, ready, write } = useCapitalPreferences(portfolios.map(item => item.id), mode);
  const etfs = portfolios.filter(item => item.kind === "etf");
  const [leftId, setLeftId] = useState(etfs[0]?.id ?? "");
  const [rightId, setRightId] = useState(etfs[1]?.id ?? "");
  const isPortfolio = view !== "lookup" && view !== "overlap";
  const visiblePortfolios = portfolios.filter(item => item.kind === view);
  const selected = visiblePortfolios.find(item => item.id === selectedId) ?? visiblePortfolios[0];
  const watched = new Set(lists.flatMap(list => list.tickers));
  const inputTickers = [...new Set(query.toUpperCase().split(/[\s,、;]+/).filter(Boolean))];
  const invalidInput = inputTickers.some(ticker => !/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker));
  const baseline = selected ? comparison === "period" ? selected.previous
    : seen[selected.id] === selected.current.id ? selected.current
    : seen[selected.id] === selected.previous?.id ? selected.previous : undefined : undefined;
  const rows = selected ? capitalRows(selected.current, baseline) : [];
  const visibleRows = rows.filter(row => (!holdingQuery.trim() || `${row.name} ${row.ticker} ${row.securityId}`.toLowerCase().includes(holdingQuery.trim().toLowerCase())) && (!selected?.previous || !changedOnly || !["unchanged", "unknown"].includes(row.change)));
  const top = rows.filter(row => row.weight > 0).slice(0, 5);
  const topWeight = top.reduce((sum, row) => sum + row.weight, 0);
  const slices = [...top.map((row, index) => ({ weight: row.weight, color: colors[index] })), ...(topWeight < 100 ? [{ weight: 100 - topWeight, color: "#405662" }] : [])];
  const left = etfs.find(item => item.id === leftId);
  const right = etfs.find(item => item.id === rightId);
  const overlap = left && right && left.id !== right.id ? etfOverlap(left.current, right.current) : null;
  const allHolders = useMemo(() => portfolios.flatMap(item => capitalRows(item.current).filter(row => row.shares > 0 && row.instrument === "stock").map(row => ({ ...row, portfolio: item }))), [portfolios]);
  const holders = allHolders.filter(row => (!inputTickers.length || inputTickers.includes(row.ticker)) && (!watchOnly || watched.has(row.ticker))).toSorted((a, b) => b.weight - a.weight);
  const searching = !invalidInput && (inputTickers.length > 0 || watchOnly);
  const labels = { new: t("新規保有", "New"), increased: t("保有増加", "Increased"), reduced: t("保有減少", "Reduced"), exited: t("保有解消", "Exited"), unchanged: t("株数変化なし", "Shares unchanged"), unknown: t("—", "—") };
  function persist(nextSaved: string[], nextSeen: Record<string, string>) {
    setMessage(write(nextSaved, nextSeen) ? t("保存しました", "Saved") : t("保存できませんでした。この画面内でのみ保持します。", "Could not save. Kept only in this session."));
  }
  function choosePortfolio(id: string) { setSelectedId(id); setHoldingQuery(""); setRowLimit(50); setChangedOnly(false); }
  function chooseView(value: View) { setView(value); choosePortfolio(portfolios.find(item => item.kind === value)?.id ?? ""); setMessage(""); }

  return <ResearchToolShell lang={lang} setLang={setLang} title="CAPITAL MAP" description="" showHeading={false} showTools={false}>
    <div className={styles.page}>
      <header className={styles.heading}><div><p className={styles.eyebrow}>TECH PHASE PRO</p><h1>CAPITAL MAP</h1><p>{t("投資先から、資金の流れを知る。", "Follow the holdings. Understand the capital.")}</p></div>{!reported && hasData && <span className={styles.edition}>SAMPLE</span>}</header>
      {!hasData ? <section className={styles.preparing}>
        <h2>{t("世界の運用会社とETFの投資先をひと目で。", "Explore the portfolios behind managers and ETFs.")}</h2>
        <p>{t("保有銘柄と構成比、銘柄ごとの保有先、ETFの重複を確認できます。", "Explore holdings, portfolio weights, stock holders and ETF overlap.")}</p>
        <Link className={styles.primary} href="/research/account">{t("ログイン・プランを確認", "Sign in / View plan")} →</Link> <Link className={styles.primary} href="/research/capital-map/sample">{t("サンプルを見る", "Explore sample")} →</Link>
      </section> : <>
        {!reported && <p className={styles.notice}>{t("架空データの表示サンプルです。", "Display sample using fictional data.")} <Link href="/research/capital-map">{t("実際の保有データを見る", "View reported holdings")} →</Link></p>}
        <nav className={styles.tabs} aria-label={t("資本マップ", "Capital map")}>
          <button aria-pressed={view === "manager"} onClick={() => chooseView("manager")}>{t("運用会社", "Managers")}</button>
          {portfolios.some(item => item.kind === "corporate") && <button aria-pressed={view === "corporate"} onClick={() => chooseView("corporate")}>{t("企業", "Companies")}</button>}
          {etfs.length > 0 && <button aria-pressed={view === "etf"} onClick={() => chooseView("etf")}>ETF</button>}
          <button aria-pressed={view === "lookup"} onClick={() => chooseView("lookup")}>{t("保有先検索", "Find holders")}</button>
          {etfs.length >= 2 && <button aria-pressed={view === "overlap"} onClick={() => chooseView("overlap")}>{t("ETF比較", "Compare ETFs")}</button>}
        </nav>
        {isPortfolio && <div className={styles.portfolioToolbar}>
          <label className={styles.portfolioSelect}>
            <select aria-label={t("表示する投資先", "Select portfolio")} value={selected?.id ?? ""} onChange={event => choosePortfolio(event.target.value)}>
              {visiblePortfolios.map(item => <option key={item.id} value={item.id}>{item.name}{item.kind === "etf" ? ` — ${item.subtitle}` : ""}</option>)}
            </select>
          </label>
        </div>}
        {view === "lookup" && <section className={styles.find} aria-labelledby="find-holders">
          <h2 id="find-holders">{t("銘柄から保有先を探す", "Find holders by stock")}</h2>
          <div className={styles.searchBar}><label><span>{t("ティッカー", "Ticker")}</span><input value={query} maxLength={200} placeholder="NVDA, NBIS, AAPL" onChange={event => { setQuery(event.target.value); setRowLimit(50); }} aria-invalid={invalidInput} /></label><button disabled={!editable} aria-pressed={watchOnly} onClick={() => { setWatchOnly(value => !value); setRowLimit(50); }}>{t("ウォッチリスト", "My watchlists")}</button></div>
          {invalidInput && <p role="status">{t("NVDAのようなティッカーを入力してください。", "Enter ticker symbols such as NVDA.")}</p>}
          {watchOnly && !watched.size && <p className={styles.empty}>{t("ウォッチリストに登録銘柄がありません。", "Your watchlists are empty.")}</p>}
          {searching && <><p className={styles.resultCount}>{holders.length} {t("件", "results")}</p><div className={styles.holders}>{holders.slice(0, rowLimit).map(row => <div key={`${row.portfolio.id}-${row.securityId}-${row.instrument}`}><StockLogo ticker={row.ticker} /><div><strong>{row.ticker}</strong><button className={styles.holderLink} onClick={() => { setView(row.portfolio.kind); choosePortfolio(row.portfolio.id); }}>{row.portfolio.name} →</button><small>{t(`${row.portfolio.current.asOf}時点`, `As of ${row.portfolio.current.asOf}`)}</small></div><div><strong>{percent(row.weight)}</strong><small>{t("構成比", "Portfolio weight")}</small></div></div>)}</div>{!holders.length && <p className={styles.empty}>{t("収録データに該当する保有先がありません。", "No holders found in the included data.")}</p>}{holders.length > rowLimit && <button className={styles.more} onClick={() => setRowLimit(value => value + 50)}>{t("さらに表示", "Show more")}</button>}</>}
        </section>}
        {selected && isPortfolio && <section className={styles.portfolio} aria-label={selected.name}>
          <div className={styles.sectionHead}><div><h2>{t("保有株の構成比", "Portfolio allocation")}</h2><p>{t(`${selected.current.asOf}時点`, `As of ${selected.current.asOf}`)}{seen[selected.id] && seen[selected.id] !== selected.current.id && <span className={styles.update}> · {t("更新あり", "Updated")}</span>}</p></div><p className={styles.allocationNote}>{t("保有評価額に占める割合", "Share of holdings value")}</p></div>
          <div className={styles.summary}>
            <div className={styles.ring} role="img" aria-label={t("保有構成比。上位5銘柄とその他。", "Portfolio weights: top five and other.")}><svg viewBox="0 0 120 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><circle cx="60" cy="60" r="50" fill="none" stroke="#405662" strokeWidth="12" />{slices.map((slice, index) => <circle key={index} cx="60" cy="60" r="50" fill="none" stroke={slice.color} strokeWidth="12" pathLength="100" strokeDasharray={`${slice.weight} ${100 - slice.weight}`} strokeDashoffset={-slices.slice(0, index).reduce((sum, item) => sum + item.weight, 0)} transform="rotate(-90 60 60)" />)}</svg><div><small>{t("構成比", "COMPOSITION")}</small><strong>{selected.kind === "etf" ? selected.name : selected.current.holdings.length}</strong><small>{selected.kind === "etf" ? `${selected.current.holdings.length} ${t("銘柄", "holdings")}` : t("銘柄", "HOLDINGS")}</small></div></div>
            <ol className={styles.legend}>{top.map((row, index) => <li key={`${row.securityId}-${row.instrument}`}><span className={styles.swatch} style={{ background: colors[index] }} /><StockLogo ticker={row.ticker} /><div><strong>{row.name}</strong><small>{row.ticker || row.securityId}{row.instrument !== "stock" && ` · ${row.instrument.toUpperCase()}`}</small></div><b>{percent(row.weight)}</b></li>)}{topWeight < 99.999 && <li><span className={styles.swatch} style={{ background: "#405662" }} /><span /><div>{t("その他", "Other")}</div><b>{percent(100 - topWeight)}</b></li>}</ol>
          </div>
          <div className={styles.listHead}><h3>{t("全保有銘柄", "All holdings")} <span>{selected.current.holdings.length}</span></h3><div className={styles.listFilters}><input aria-label={t("保有銘柄を絞り込む", "Filter holdings")} placeholder={t("この保有一覧を検索", "Search these holdings")} value={holdingQuery} onChange={event => { setHoldingQuery(event.target.value); setRowLimit(50); }} /></div></div>
          {selected.previous && <div className={styles.changeHead}><h3><select aria-label={t("変化の比較基準", "Change comparison basis")} value={comparison} onChange={event => setComparison(event.target.value as "period" | "visit")}><option value="period">{selected.kind !== "etf" ? t("前期からの変化", "Since prior quarter") : t("前日からの変化", "Since prior day")}</option><option value="visit">{t("前回確認からの変化", "Since my last check")}</option></select><small>{baseline?.asOf}</small></h3><label><input type="checkbox" checked={changedOnly} onChange={event => { setChangedOnly(event.target.checked); setRowLimit(50); }} />{t("変化のみ", "Changes only")}</label></div>}
          {selected.previous && comparison === "visit" && !baseline && <p className={styles.footnote}>{t("確認済みにすると、次回の比較基準として保存されます。", "Mark as viewed to save a baseline for your next visit.")}</p>}
          <div className={`${styles.columnHead} ${selected.previous ? styles.withChangeHead : ""}`}><span>{t("企業名 / ティッカー", "Company / ticker")}</span><span>{t("構成比", "Weight")}</span>{selected.previous && <span>{t("変化", "Change")}</span>}</div>
          <div className={styles.holdings}>{visibleRows.slice(0, rowLimit).map(row => <div className={`${styles.holding} ${selected.previous ? styles.withChange : ""}`} key={`${row.securityId}-${row.instrument}`}><StockLogo ticker={row.ticker} /><div className={styles.stock}><strong>{row.name}</strong><small>{row.ticker || `CUSIP ${row.securityId}`}{row.instrument !== "stock" && <b className={styles.option}>{row.instrument.toUpperCase()}</b>}</small></div><div className={styles.weight}><strong>{percent(row.weight)}</strong></div>{selected.previous && <div className={styles.change} data-change={row.change}><strong>{labels[row.change]}</strong><small>{row.shareChangePercent === null ? "—" : signed(row.shareChangePercent)}</small></div>}</div>)}{!visibleRows.length && <p className={styles.empty}>{t("該当する銘柄がありません。", "No matching holdings.")}</p>}</div>
          {visibleRows.length > rowLimit && <button className={styles.more} onClick={() => setRowLimit(value => value + 50)}>{t("さらに表示", "Show more")} · {Math.min(rowLimit, visibleRows.length)} / {visibleRows.length}</button>}
          <div className={styles.visit}><button disabled={!ready || seen[selected.id] === selected.current.id} onClick={() => persist(saved, { ...seen, [selected.id]: selected.current.id })}>{seen[selected.id] === selected.current.id ? t("✓ 確認済み", "✓ Viewed") : t("確認済みにする", "Mark as viewed")}</button></div>
          {selected.previous && !reported && <button className={styles.simulate} disabled={!ready} onClick={() => persist(saved, { ...seen, [selected.id]: selected.previous!.id })}>{t("サンプル：更新後の表示を試す", "Sample: simulate an update")}</button>}
          <details className={styles.source} key={selected.id}><summary>{t("データについて", "About this data")}</summary>
            {selected.current.source && <><p><a href={selected.current.source.url} target="_blank" rel="noreferrer">{selected.kind === "etf" ? t("運用元の保有明細", "Issuer holdings") : t("SEC保有明細", "SEC holdings")}</a>{selected.kind !== "etf" && <a href={selected.current.source.coverUrl} target="_blank" rel="noreferrer">{t("SEC集計表", "SEC summary")}</a>}</p><p>{t("基準日", "As of")} {selected.current.asOf} · {t("公表日", "Published")} {selected.current.publishedOn}</p></>}
            <p>{selected.kind === "etf" ? t("構成比は運用元の公表値です。現金・先物等を除いた株式の一覧で、比率の再計算はしていません。", "Weights are published by the issuer. The list contains equities, excluding cash and futures; weights are not renormalized.") : t("構成比は公開13Fの報告評価額に対する割合です。同じ銘柄・株式クラスを集計し、オプションは分けて表示します。現金や開示対象外の資産は含みません。", "Weights use the public 13F reported values. Identical securities and share classes are aggregated; options are separate. Cash and assets outside the filing are excluded.")}</p>
          </details>
        </section>}
        {view === "overlap" && etfs.length >= 2 && <section className={styles.overlap} aria-labelledby="etf-overlap"><h2 id="etf-overlap">{t("ETFの重複を比較", "Compare ETF overlap")}</h2><div className={styles.compare}><select aria-label={t("比較するETF 1", "First ETF")} value={leftId} onChange={event => setLeftId(event.target.value)}>{etfs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span>×</span><select aria-label={t("比較するETF 2", "Second ETF")} value={rightId} onChange={event => setRightId(event.target.value)}>{etfs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{overlap && <strong>{percent(overlap.percent)}<small>{reported ? t("加重重複率", "Weighted overlap") : t("加重重複率 · 架空", "Weighted overlap · fictional")}</small></strong>}</div>
          <p className={styles.footnote}>{left?.name} {t(`${left?.current.asOf}時点`, `As of ${left?.current.asOf}`)} · {right?.name} {t(`${right?.current.asOf}時点`, `As of ${right?.current.asOf}`)}</p>
          {!overlap ? <p className={styles.empty}>{t("異なるETFを選んでください。", "Choose two different ETFs.")}</p> : <><div className={styles.overlapBar}><span style={{ width: `${overlap.percent}%` }} /></div><div className={styles.overlapRows}>{overlap.rows.map(row => <div key={row.ticker}><strong>{row.ticker || row.name}</strong><span>{left?.name} {percent(row.left)}</span><span>{right?.name} {percent(row.right)}</span></div>)}</div><details className={styles.source}><summary>{t("計算方法", "Method")}</summary><p>{t("共通する株式ごとに小さい方の構成比を合計します。現金・先物等は計算に含みません。", "Sum of the smaller weight for each shared equity. Cash and futures are excluded.")}</p></details></>}
        </section>}
        <details className={styles.usage}><summary>{t("使い方", "How to use")}</summary><p>{t("確認済みの記録は、このブラウザーに保存します。検索は収録対象の公開保有情報を参照します。", "Viewed records are saved in this browser. Search covers the public holdings included in Capital Map.")}</p></details>
        <p className={styles.message} role="status">{message}</p>
      </>}
    </div>
  </ResearchToolShell>;
}
