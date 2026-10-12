"use client";

import Link from "next/link";
import Image from "next/image";
import { capitalProfiles } from "@/lib/research/capital-map-profiles";
import { useMemo, useState } from "react";
import { capitalRows, etfOverlap, type CapitalPortfolio } from "@/lib/research/capital-map";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { useStockFavorites } from "../use-stock-favorites";
import StockLogo from "../watchlist/stock-logo";
import { useCapitalPreferences } from "./use-capital-preferences";
import styles from "./capital-map.module.css";

const emptyPortfolios: CapitalPortfolio[] = [];
const colors = ["#9875ff", "#ffb52e", "#46b4ff", "#ef69b6", "#28c7bc", "#ff8548", "#8596ff", "#9bce50", "#e6cf70", "#63c6de"];
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
  const [portraitError, setPortraitError] = useState("");
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
  const profile = selected ? capitalProfiles[selected.id.split("-")[0]] : undefined;
  const totalValue = selected?.current.holdings.reduce((sum, row) => sum + row.value, 0) ?? 0;
  const money = (value: number) => new Intl.NumberFormat(lang === "ja" ? "ja-JP" : "en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value);
  const hasValues = totalValue > 0;
  const watched = new Set(lists.flatMap(list => list.tickers));
  const inputTickers = [...new Set(query.toUpperCase().split(/[,、;]+/).map(value => value.trim()).filter(Boolean))];

  const baseline = selected ? comparison === "period" ? selected.previous
    : seen[selected.id] === selected.current.id ? selected.current
    : seen[selected.id] === selected.previous?.id ? selected.previous : undefined : undefined;
  const rows = selected ? capitalRows(selected.current, baseline) : [];
  const visibleRows = rows.filter(row => (!holdingQuery.trim() || `${row.name} ${row.ticker} ${row.securityId}`.toLowerCase().includes(holdingQuery.trim().toLowerCase())) && (!selected?.previous || !changedOnly || !["unchanged", "unknown"].includes(row.change)));
  const top = rows.filter(row => row.weight > 0).slice(0, 10);
  const topWeight = top.reduce((sum, row) => sum + row.weight, 0);
  const slices = [...top.map((row, index) => ({ weight: row.weight, color: colors[index], label: row.ticker || row.name })), ...(topWeight < 100 ? [{ weight: 100 - topWeight, color: "#536072", label: t("その他", "Other") }] : [])];
  const left = etfs.find(item => item.id === leftId);
  const right = etfs.find(item => item.id === rightId);
  const overlap = left && right && left.id !== right.id ? etfOverlap(left.current, right.current) : null;
  const allHolders = useMemo(() => portfolios.flatMap(item => capitalRows(item.current).filter(row => row.shares > 0 && row.instrument === "stock").map(row => ({ ...row, portfolio: item }))), [portfolios]);
  const knownTickers = new Set(allHolders.map(row => row.ticker));
  const holders = allHolders.filter(row => (!inputTickers.length || inputTickers.some(term => knownTickers.has(term) ? row.ticker === term : row.name.toUpperCase().includes(term))) && (!watchOnly || watched.has(row.ticker))).toSorted((a, b) => b.weight - a.weight);
  const searching = (inputTickers.length > 0 || watchOnly);
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
          <button aria-pressed={view === "lookup"} onClick={() => chooseView("lookup")}>{t("銘柄から探す", "Search by stock")}</button>
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
          <h2 id="find-holders">{t("この株を持つ運用会社・ETFを探す", "Which managers and ETFs hold this stock?")}</h2>
          <p className={styles.explainer}>{t("銘柄を入力すると、保有している会社やETFと、その中での構成比・保有評価額が分かります。", "Enter a stock to see which managers and ETFs hold it, how much they hold and its weight in each portfolio.")}</p>
          <div className={styles.searchBar}><label><span>{t("企業名・ティッカー", "Company name or ticker")}</span><input value={query} maxLength={200} placeholder="NVIDIA / NVDA" onChange={event => { setQuery(event.target.value); setRowLimit(50); }} /></label><button disabled={!editable} aria-pressed={watchOnly} onClick={() => { setWatchOnly(value => !value); setRowLimit(50); }}>{t("自分のウォッチリストで探す", "Use my watchlists")}</button></div>
          {!searching && <div className={styles.examples}><span>{t("試してみる", "Try a stock")}</span>{["NVDA", "AAPL", "MU"].map(ticker => <button key={ticker} onClick={() => { setQuery(ticker); setRowLimit(50); }}>{ticker}</button>)}</div>}
          {watchOnly && !watched.size && <p className={styles.empty}>{t("ウォッチリストに登録銘柄がありません。", "Your watchlists are empty.")}</p>}
          {searching && <><p className={styles.resultCount}>{holders.length} {t("件", "results")}</p><div className={styles.holders}>{holders.slice(0, rowLimit).map(row => <div key={`${row.portfolio.id}-${row.securityId}-${row.instrument}`}><StockLogo ticker={row.ticker} /><div><strong>{row.ticker}</strong><button className={styles.holderLink} onClick={() => { setView(row.portfolio.kind); choosePortfolio(row.portfolio.id); }}>{row.portfolio.name} →</button><small>{t(`${row.portfolio.current.asOf}時点`, `As of ${row.portfolio.current.asOf}`)}</small></div><div><strong>{percent(row.weight)}</strong><small>{t("保有内の構成比", "Portfolio weight")}</small><small>{row.value > 0 ? money(row.value) : "—"}</small></div></div>)}</div>{!holders.length && <p className={styles.empty}>{t("収録データに該当する保有先がありません。", "No holders found in the included data.")}</p>}{holders.length > rowLimit && <button className={styles.more} onClick={() => setRowLimit(value => value + 50)}>{t("さらに表示", "Show more")}</button>}</>}
        </section>}
        {selected && isPortfolio && <section className={styles.portfolio} aria-label={selected.name}>
          <div className={styles.identity}>
            {profile ? <><div className={styles.person}>{profile.portrait && portraitError !== selected.id && <span className={styles.portrait}><Image unoptimized src={profile.portrait.url} alt={t(...profile.person)} width={64} height={64} className={selected.id.startsWith("bridgewater") ? styles.rayPortrait : undefined} onError={() => setPortraitError(selected.id)} /></span>}<div><strong>{t(...profile.person)}</strong><small>{t(...profile.role)}{profile.leadership && ` · ${t(...profile.leadership)}`}</small></div></div><p>{t(...profile.description)}</p></> : <p>{selected.kind === "etf" ? selected.subtitle : t("企業が公開している株式の保有ポートフォリオ。", "Equity investments disclosed by the company.")}</p>}
          </div>
          <div className={styles.metrics}>
            <div><small>{t("基準日", "AS OF")}</small><strong>{selected.current.asOf}<span>{t("時点", "")}</span></strong></div>
            <div><small>{t("保有銘柄数", "HOLDINGS")}</small><strong>{selected.current.holdings.length.toLocaleString()}<span>{t("銘柄", "holdings")}</span></strong></div>
            <div><small>{t("上位5銘柄の構成比", "TOP 5 WEIGHT")}</small><strong>{percent(top.slice(0, 5).reduce((sum, row) => sum + row.weight, 0))}</strong></div>
          </div>
          <div className={styles.portfolioBody}>
            <div className={styles.chartPanel}>
              <div className={styles.ring} role="img" aria-label={t("保有構成比。上位10銘柄とその他。", "Portfolio weights: top ten and other.")}>
                <svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                  <circle cx="200" cy="200" r="148" fill="none" stroke="#536072" strokeWidth="76" />
                  {slices.map((slice, index) => {
                    const start = slices.slice(0, index).reduce((sum, item) => sum + item.weight, 0);
                    const angle = (start + slice.weight / 2) * Math.PI / 50 - Math.PI / 2;
                    return <g key={index}><circle cx="200" cy="200" r="148" fill="none" stroke={slice.color} strokeWidth="76" pathLength="100" strokeDasharray={`${Math.max(0, slice.weight - .18)} ${100 - Math.max(0, slice.weight - .18)}`} strokeDashoffset={-start} transform="rotate(-90 200 200)" /><title>{slice.label}: {percent(slice.weight)}</title>{slice.weight >= 5 && <text x={200 + 148 * Math.cos(angle)} y={200 + 148 * Math.sin(angle) - 5} textAnchor="middle" className={styles.sliceLabel}><tspan>{slice.label.length > 8 ? slice.label.slice(0, 7) + "…" : slice.label}</tspan><tspan x={200 + 148 * Math.cos(angle)} dy="18">{slice.weight.toFixed(1)}%</tspan></text>}</g>;
                  })}
                </svg>
                <div><small>{t("保有評価額の合計", "TOTAL HOLDINGS VALUE")}</small><strong title={hasValues ? `$${totalValue.toLocaleString("en-US")}` : undefined}>{hasValues ? money(totalValue) : selected.name}</strong><small>{hasValues ? "USD" : t("保有構成比", "PORTFOLIO WEIGHT")}</small></div>
              </div>
              <p className={styles.chartCaption}>{t("色は銘柄一覧と対応", "Colors match the holdings list")}<br />{t("構成比＝保有評価額に占める割合", "Weight = share of holdings value")}</p>
              {slices.length > top.length && <p className={styles.otherKey}><i />{t("その他", "Other")} <strong>{percent(100 - topWeight)}</strong><span>{t("上位10銘柄以外の配分", "Allocation outside the top 10")}</span></p>}
            </div>
            <div className={styles.tablePanel}>
          <div className={styles.listHead}><h3>{t("全保有銘柄", "All holdings")} <span>{selected.current.holdings.length}</span></h3><div className={styles.listFilters}><input aria-label={t("保有銘柄を絞り込む", "Filter holdings")} placeholder={t("この保有一覧を検索", "Search these holdings")} value={holdingQuery} onChange={event => { setHoldingQuery(event.target.value); setRowLimit(50); }} /></div></div>
          {selected.previous && <div className={styles.changeHead}><h3><select aria-label={t("変化の比較基準", "Change comparison basis")} value={comparison} onChange={event => setComparison(event.target.value as "period" | "visit")}><option value="period">{selected.kind !== "etf" ? t("前期からの変化", "Since prior quarter") : t("前日からの変化", "Since prior day")}</option><option value="visit">{t("前回確認からの変化", "Since my last check")}</option></select><small>{baseline?.asOf}</small></h3><label><input type="checkbox" checked={changedOnly} onChange={event => { setChangedOnly(event.target.checked); setRowLimit(50); }} />{t("変化のみ", "Changes only")}</label></div>}
          {selected.previous && comparison === "visit" && !baseline && <p className={styles.footnote}>{t("確認済みにすると、次回の比較基準として保存されます。", "Mark as viewed to save a baseline for your next visit.")}</p>}
          <div className={styles.positionHead}><span>{t("企業名 / ティッカー", "Company / ticker")}</span><span>{t("構成比", "Weight")}</span><span>{t("保有評価額", "Value")}</span><span>{t("株数の前回比", "Share change")}</span></div>
          <div className={styles.holdings}>{visibleRows.slice(0, rowLimit).map(row => {
            const colorIndex = top.findIndex(item => item.securityId === row.securityId && item.instrument === row.instrument);
            return <div className={styles.position} key={`${row.securityId}-${row.instrument}`}>
              <div className={styles.positionStock}><span className={styles.positionColor} style={{ background: colors[colorIndex] ?? "#536072" }} /><StockLogo ticker={row.ticker} /><div className={styles.stock}><strong title={row.name}>{row.name}</strong><small>{row.ticker || `CUSIP ${row.securityId}`}{row.instrument !== "stock" && <b className={styles.option}>{row.instrument.toUpperCase()}</b>}</small></div></div>
              <span className={styles.positionWeight}><strong>{percent(row.weight)}</strong><i style={{ width: `${Math.min(100, row.weight)}%`, background: colors[colorIndex] ?? "#536072" }} /></span>
              <span className={styles.positionValue} title={hasValues ? `$${row.value.toLocaleString("en-US")}` : t("評価額は未収録", "Value not included")}>{hasValues ? money(row.value) : "—"}</span>
              <span className={styles.positionChange} data-change={row.change} title={row.change === "unknown" ? t("比較できる前回データがありません", "No comparable prior data") : `${row.shares.toLocaleString("en-US")} ${t("株", "shares")}`}><strong>{row.shareChangePercent === null ? labels[row.change] : signed(row.shareChangePercent)}</strong>{row.shareChangePercent !== null && <small>{labels[row.change]}</small>}</span>
            </div>;
          })}{!visibleRows.length && <p className={styles.empty}>{t("該当する銘柄がありません。", "No matching holdings.")}</p>}</div>
          {!baseline && <p className={styles.missingHistory}>{t("前回比の「—」は比較データ未収録です。", "A dash in Share change means prior data is not yet included.")}</p>}
          {visibleRows.length > rowLimit && <button className={styles.more} onClick={() => setRowLimit(value => value + 50)}>{t("さらに表示", "Show more")} · {Math.min(rowLimit, visibleRows.length)} / {visibleRows.length}</button>}
            </div>
          </div>
          <div className={styles.visit}><button disabled={!ready || seen[selected.id] === selected.current.id} onClick={() => persist(saved, { ...seen, [selected.id]: selected.current.id })}>{seen[selected.id] === selected.current.id ? t("✓ 確認済み", "✓ Viewed") : t("確認済みにする", "Mark as viewed")}</button></div>
          {selected.previous && !reported && <button className={styles.simulate} disabled={!ready} onClick={() => persist(saved, { ...seen, [selected.id]: selected.previous!.id })}>{t("サンプル：更新後の表示を試す", "Sample: simulate an update")}</button>}
          <details className={styles.source} key={selected.id}><summary>{t("データについて", "About this data")}</summary>
            {profile && <p><a href={profile.source} target="_blank" rel="noreferrer">{t("人物・会社紹介の出典", "Profile source")}</a> · {t("役職確認：2026-10-12", "Roles checked: 2026-10-12")}</p>}
            {profile?.portrait && <p>{t("写真", "Photo")}: {profile.portrait.credit} · <a href={profile.portrait.source} target="_blank" rel="noreferrer">Wikimedia Commons</a><a href={profile.portrait.licenseUrl} target="_blank" rel="noreferrer">{profile.portrait.license}</a>{t("（表示枠に合わせてトリミング）", " (cropped to fit)")}</p>}
            {selected.current.source && <><p><a href={selected.current.source.url} target="_blank" rel="noreferrer">{selected.kind === "etf" ? t("運用元の保有明細", "Issuer holdings") : t("SEC保有明細", "SEC holdings")}</a>{selected.kind !== "etf" && <a href={selected.current.source.coverUrl} target="_blank" rel="noreferrer">{t("SEC集計表", "SEC summary")}</a>}</p><p>{t("基準日", "As of")} {selected.current.asOf} · {t("公表日", "Published")} {selected.current.publishedOn}</p></>}
            <p>{selected.kind === "etf" ? t("構成比は運用元の公表値です。現金・先物等を除いた株式の一覧で、比率の再計算はしていません。", "Weights are published by the issuer. The list contains equities, excluding cash and futures; weights are not renormalized.") : t("構成比は公開13Fの報告評価額に対する割合です。同じ銘柄・株式クラスを集計し、オプションは分けて表示します。現金や開示対象外の資産は含みません。", "Weights use the public 13F reported values. Identical securities and share classes are aggregated; options are separate. Cash and assets outside the filing are excluded.")}</p>
          </details>
        </section>}
        {view === "overlap" && etfs.length >= 2 && <section className={styles.overlap} aria-labelledby="etf-overlap">
          <h2 id="etf-overlap">{t("2つのETFを買うと、投資先はどれだけ重なる？", "Buying two ETFs? See where their holdings overlap.")}</h2>
          <p className={styles.explainer}>{t("違うETFでも、中に入っている株は同じことがあります。共通する銘柄と配分を比べて、投資先の偏りを確認できます。", "Different ETFs can own the same stocks. Compare their shared holdings and weights to see where your investments would overlap.")}</p>
          <div className={styles.compare}><label>ETF 1<select aria-label={t("比較するETF 1", "First ETF")} value={leftId} onChange={event => setLeftId(event.target.value)}>{etfs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><span>＋</span><label>ETF 2<select aria-label={t("比較するETF 2", "Second ETF")} value={rightId} onChange={event => setRightId(event.target.value)}>{etfs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
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
        <details className={styles.usage}><summary>{t("使い方", "How to use")}</summary><p>{t("確認済みの記録は、このブラウザーに保存します。検索は収録対象の公開保有情報を参照します。", "Viewed records are saved in this browser. Search covers the public holdings included in Capital Map.")}</p></details>
        <p className={styles.message} role="status">{message}</p>
      </>}
    </div>
  </ResearchToolShell>;
}
