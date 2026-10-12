"use client";

import Link from "next/link";
import { useState } from "react";
import { capitalRows, etfOverlap, type CapitalPortfolio } from "@/lib/research/capital-map";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import { useStockFavorites } from "../use-stock-favorites";
import StockLogo from "../watchlist/stock-logo";
import { useCapitalPreferences } from "./use-capital-preferences";
import styles from "./capital-map.module.css";

const emptyPortfolios: CapitalPortfolio[] = [];
const colors = ["#88d9bc", "#78b5e1", "#a59cde", "#dda88b", "#7bc9cb"];
const percent = (value: number) => `${value.toFixed(2)}%`;
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

export default function CapitalMap({ portfolios = emptyPortfolios }: { portfolios?: CapitalPortfolio[] }) {
  const [lang, setLang] = useResearchLanguage();
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const { lists, editable } = useStockFavorites();
  const sample = portfolios.length > 0;
  const [kind, setKind] = useState<"manager" | "etf">("manager");
  const [selectedId, setSelectedId] = useState(portfolios[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [watchOnly, setWatchOnly] = useState(false);
  const [comparison, setComparison] = useState<"period" | "visit">("period");
  const [changedOnly, setChangedOnly] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [message, setMessage] = useState("");
  const { saved, seen, ready, write } = useCapitalPreferences(portfolios.map(item => item.id));
  const etfs = portfolios.filter(item => item.kind === "etf");
  const [leftId, setLeftId] = useState(etfs[0]?.id ?? "");
  const [rightId, setRightId] = useState(etfs[1]?.id ?? "");
  const visiblePortfolios = portfolios.filter(item => item.kind === kind && (!savedOnly || saved.includes(item.id)));
  const selected = visiblePortfolios.find(item => item.id === selectedId) ?? visiblePortfolios[0];
  const watched = new Set(lists.flatMap(list => list.tickers));
  const inputTickers = [...new Set(query.toUpperCase().split(/[\s,、;]+/).filter(Boolean))];
  const invalidInput = inputTickers.some(ticker => !/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker));
  const matches = (ticker: string) => (!inputTickers.length || inputTickers.includes(ticker)) && (!watchOnly || watched.has(ticker));
  const baseline = selected ? comparison === "period" ? selected.previous
    : seen[selected.id] === selected.current.id ? selected.current
    : seen[selected.id] === selected.previous.id ? selected.previous : undefined : undefined;
  const rows = selected ? capitalRows(selected.current, baseline) : [];
  const visibleRows = rows.filter(row => matches(row.ticker) && (!changedOnly || !["unchanged", "unknown"].includes(row.change)));
  const top = rows.filter(row => row.weight > 0).slice(0, 5);
  const stops = top.map((row, index) => {
    const start = top.slice(0, index).reduce((sum, holding) => sum + holding.weight, 0);
    return `${colors[index]} ${start}% ${start + row.weight}%`;
  });
  const topWeight = top.reduce((sum, row) => sum + row.weight, 0);
  if (topWeight < 100) stops.push(`#293844 ${topWeight}% 100%`);
  const left = etfs.find(item => item.id === leftId);
  const right = etfs.find(item => item.id === rightId);
  const overlap = left && right && left.id !== right.id ? etfOverlap(left.current, right.current) : null;
  const holders = portfolios.flatMap(item => capitalRows(item.current).filter(row => row.shares > 0 && matches(row.ticker)).map(row => ({ ...row, portfolio: item })));
  const labels = { new: t("新規保有", "New"), increased: t("保有増加", "Increased"), reduced: t("保有減少", "Reduced"), exited: t("保有解消", "Exited"), unchanged: t("株数変化なし", "Shares unchanged"), unknown: t("比較未確認", "Not comparable") };
  function persist(nextSaved: string[], nextSeen: Record<string, string>) {
    setMessage(write(nextSaved, nextSeen) ? t("このブラウザーに保存しました", "Saved in this browser") : t("保存できませんでした。この画面内でのみ保持します。", "Could not save. Kept only in this session."));
  }
  function chooseKind(value: "manager" | "etf") { setKind(value); setSelectedId(portfolios.find(item => item.kind === value)?.id ?? ""); }

  return <ResearchToolShell lang={lang} setLang={setLang} title="CAPITAL MAP" description="" showHeading={false} showTools={false}>
    <div className={styles.page}>
      <header className={styles.heading}><div><p className={styles.eyebrow}>TECH PHASE RESEARCH</p><h1>CAPITAL MAP</h1><p>{t("運用会社とETFの投資先をひと目で。", "Manager portfolios and ETF holdings, at a glance.")}</p></div><span className={styles.edition}>{sample ? t("表示サンプル", "DISPLAY SAMPLE") : t("提供準備中", "IN DEVELOPMENT")}</span></header>
      {!sample ? <section className={styles.preparing}>
        <h2>{t("誰が、何を、どれだけ持っている？", "Who holds what, and how much?")}</h2>
        <p>{t("運用会社の保有銘柄とETFの構成、前回からの変化をまとめて確認できるページを制作しています。", "We are building a view of manager portfolios, ETF composition and changes since your last visit.")}</p>
        <Link className={styles.primary} href="/research/capital-map/sample">{t("表示サンプルを見る", "Explore the display sample")} →</Link>
        <ul><li>{t("構成比と保有銘柄の変化", "Composition and holding changes")}</li><li>{t("銘柄入力・ウォッチリストで保有先を確認", "Find holders by ticker or watchlist")}</li><li>{t("追う運用会社・ETFの保存", "Follow managers and ETFs")}</li><li>{t("ETF同士の重複を確認", "Explore overlapping ETF holdings")}</li></ul>
        <p className={styles.footnote}>{t("実データの取得・更新は未稼働です。機関投資家比率と企業の出資先は、データの確認後に追加を検討します。", "Data collection and updates are not running. Institutional ownership and corporate investments await data verification.")}</p>
      </section> : <>
        <p className={styles.notice}>{t("すべて架空データ。実際の保有・取引・構成比を示すものではありません。", "All data is fictional. These are not actual holdings, trades or portfolio weights.")}</p>
        <nav className={styles.tabs} aria-label={t("投資先の種類", "Portfolio type")}><button aria-pressed={kind === "manager"} onClick={() => chooseKind("manager")}>{t("運用会社", "Managers")}</button><button aria-pressed={kind === "etf"} onClick={() => chooseKind("etf")}>ETF</button><button className={styles.savedTab} aria-pressed={savedOnly} onClick={() => setSavedOnly(value => !value)}>{t("保存した対象", "Following")} {saved.length}</button></nav>
        <div className={styles.portfolios}>{visiblePortfolios.map(item => <button key={item.id} aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)}><strong>{item.name}</strong><small>{item.subtitle}</small>{seen[item.id] && seen[item.id] !== item.current.id && <span className={styles.update}>{t("更新あり", "Updated")}</span>}</button>)}{!visiblePortfolios.length && <p className={styles.empty}>{t("この種類で保存した対象はありません。", "No followed portfolios of this type.")}</p>}</div>
        <section className={styles.find} aria-labelledby="find-holders">
          <h2 id="find-holders">{t("この銘柄、誰が持っている？", "Who holds these stocks?")}</h2>
          <div className={styles.searchBar}><label><span>{t("ティッカーを入力", "Enter tickers")}</span><input value={query} maxLength={200} placeholder="NVDA, NBIS, AAPL" onChange={event => setQuery(event.target.value)} aria-invalid={invalidInput} /></label><button disabled={!editable} aria-pressed={watchOnly} onClick={() => setWatchOnly(value => !value)}>{t("ウォッチリストで絞る", "Filter by watchlist")}</button></div>
          {invalidInput && <p role="status">{t("銘柄名ではなく、NVDAのようなティッカーを入力してください。", "Enter ticker symbols such as NVDA, rather than company names.")}</p>}
          {watchOnly && !watched.size && <p className={styles.empty}>{t("ウォッチリストに登録銘柄がありません。", "Your watchlists are empty.")}</p>}
          <p className={styles.footnote}>{t("入力した銘柄は保存しません。絞り込みは全ウォッチリストを参照し、リストを変更しません。", "Ticker inputs are not saved. This filter reads all watchlists without changing them.")}</p>
          {(inputTickers.length > 0 || watchOnly) && <><div className={styles.holders}>{holders.map(row => <div key={`${row.portfolio.id}-${row.securityId}-${row.instrument}`}><div><strong>{row.ticker}{row.instrument !== "stock" && <b className={styles.option}>{row.instrument.toUpperCase()}</b>}</strong><small>{row.portfolio.name}</small></div><div><strong>{percent(row.weight)}</strong><small>{t("報告資産内", "of reported assets")}</small></div><div><strong>{row.companyPercent === null ? "—" : percent(row.companyPercent)}</strong><small>{t("企業の株式に対する保有率", "of company shares")}</small></div></div>)}</div>{!holders.length && <p className={styles.empty}>{t("表示対象の架空データに該当情報はありません。保有者がいないという意味ではありません。", "No matches in these fictional portfolios. This does not mean there are no holders.")}</p>}<p className={styles.footnote}>{t("企業の株式に対する保有率は未確認です。機関投資家全体の保有率は未対応です。", "Company ownership is unverified. Aggregate institutional ownership is not implemented.")}</p></>}
        </section>
        {selected && <section className={styles.portfolio} aria-labelledby="portfolio-name">
          <div className={styles.sectionHead}><div><h2 id="portfolio-name">{selected.name}</h2><p>{t("架空の基準日", "Fictional as-of date")} {selected.current.asOf}<span> · {t("架空の公表日", "Fictional publication date")} {selected.current.publishedOn}</span></p></div><button className={styles.save} disabled={!ready} aria-pressed={saved.includes(selected.id)} onClick={() => persist(saved.includes(selected.id) ? saved.filter(id => id !== selected.id) : [...saved, selected.id], seen)}>{saved.includes(selected.id) ? "★ " : "☆ "}{t("追う", "Follow")}</button></div>
          <div className={styles.summary}><div className={styles.ring} style={{ background: `conic-gradient(${stops.join(",")})` }} role="img" aria-label={t("架空の構成比。各銘柄の割合は一覧に表示しています。", "Fictional composition. Individual weights are listed alongside.")}><div><small>{t("構成比", "COMPOSITION")}</small><strong>{selected.kind === "etf" ? selected.name : "13F"}</strong><small>{t("架空データ", "FICTIONAL")}</small></div></div><ol className={styles.legend}>{top.map((row, index) => <li key={`${row.securityId}-${row.instrument}`}><span className={styles.swatch} style={{ background: colors[index] }} /><StockLogo ticker={row.ticker} /><div><strong>{row.name}</strong><small>{row.ticker}{row.instrument !== "stock" && ` · ${row.instrument.toUpperCase()}`}</small></div><b>{percent(row.weight)}</b></li>)}{topWeight < 99.999 && <li><span className={styles.swatch} style={{ background: "#293844" }} /><span /><div>{t("その他", "Other")}</div><b>{percent(100 - topWeight)}</b></li>}</ol></div>
          <p className={styles.footnote}>{selected.kind === "manager" ? t("構成比は報告対象資産内の割合です。現金・未上場投資を含む全資産の割合ではありません。", "Weights are within reportable holdings, not total assets including cash and private investments.") : t("ETFの比率は基準日時点のものです。株価による比率の変化と保有株数の変化は区別します。", "ETF weights are as of the stated date. Price-driven weight changes are separate from share-count changes.")}</p>
          <div className={styles.changeHead}><h3><select aria-label={t("変化の比較基準", "Change comparison basis")} value={comparison} onChange={event => setComparison(event.target.value as "period" | "visit")}><option value="period">{selected.kind === "manager" ? t("前期からの変化", "Since the prior quarter") : t("前日からの変化", "Since the prior day")}</option><option value="visit">{t("前回確認からの変化", "Since my last check")}</option></select><small>{baseline?.asOf ?? t("未確認", "Not yet checked")}</small></h3><label><input type="checkbox" checked={changedOnly} onChange={event => setChangedOnly(event.target.checked)} />{t("株数が変わった銘柄だけ", "Share-count changes only")}</label></div>
          {comparison === "visit" && !baseline && <p className={styles.footnote}>{t("前回の確認記録がありません。確認済みにすると次の更新との比較基準になります。", "No prior check is recorded. Mark this version as viewed to establish a baseline.")}</p>}
          <div className={styles.holdings}>{visibleRows.map(row => <div className={styles.holding} key={`${row.securityId}-${row.instrument}`}><StockLogo ticker={row.ticker} /><div className={styles.stock}><strong>{row.name}</strong><small>{row.ticker}{row.instrument !== "stock" && <b className={styles.option}>{row.instrument.toUpperCase()}</b>}</small></div><div className={styles.weight}><strong>{percent(row.weight)}</strong><small>{row.shares.toLocaleString("en-US")} {t("株相当", "reported units")}</small></div><div className={styles.change} data-change={row.change}><strong>{labels[row.change]}</strong><small>{row.shareChangePercent === null ? "—" : signed(row.shareChangePercent)}</small></div></div>)}{!visibleRows.length && <p className={styles.empty}>{t("この条件に該当する保有銘柄はありません。", "No holdings match these filters.")}</p>}</div>
          <div className={styles.visit}><span>{seen[selected.id] === selected.current.id ? t("この表示版を確認済み", "This version is marked as viewed") : seen[selected.id] ? t("前回の確認後に更新あり", "Updated since your last check") : t("この表示版は未確認", "This version has not been marked as viewed")}</span><button disabled={!ready || seen[selected.id] === selected.current.id} onClick={() => persist(saved, { ...seen, [selected.id]: selected.current.id })}>{t("確認済みにする", "Mark as viewed")}</button></div><button className={styles.simulate} disabled={!ready} onClick={() => persist(saved, { ...seen, [selected.id]: selected.previous.id })}>{t("サンプル：前回の確認後に更新された状態を見る", "Sample: simulate an update since your last check")}</button>
        </section>}
        <section className={styles.overlap} aria-labelledby="etf-overlap"><h2 id="etf-overlap">{t("ETFの中身、どれくらい重なる？", "How much do these ETFs overlap?")}</h2><div className={styles.compare}><select aria-label={t("比較するETF 1", "First ETF")} value={leftId} onChange={event => setLeftId(event.target.value)}>{etfs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span>×</span><select aria-label={t("比較するETF 2", "Second ETF")} value={rightId} onChange={event => setRightId(event.target.value)}>{etfs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{overlap && <strong>{percent(overlap.percent)}<small>{t("加重重複率 · 架空", "weighted overlap · fictional")}</small></strong>}</div>
          {!overlap ? <p className={styles.empty}>{t("異なるETFを選んでください。", "Choose two different ETFs.")}</p> : <><div className={styles.overlapBar}><span style={{ width: `${overlap.percent}%` }} /></div><div className={styles.overlapRows}>{overlap.rows.map(row => <div key={row.ticker}><strong>{row.ticker}</strong><span>{left?.name} {percent(row.left)}</span><span>{right?.name} {percent(row.right)}</span></div>)}</div><p className={styles.footnote}>{t("共通銘柄ごとに小さい方の構成比を合計します。あなたの保有金額を使った資産配分の計算ではありません。", "Sum of the smaller weight for each shared security, not an allocation calculation based on your invested amounts.")}</p></>}
        </section>
        <p className={styles.storageNote}>{t("追う対象と確認済みの記録は、このブラウザーに保存します。アカウント・端末間の同期は未対応です。", "Following and viewed records are saved in this browser. Account and cross-device sync are not implemented.")}</p><p className={styles.message} role="status">{message}</p>
      </>}
    </div>
  </ResearchToolShell>;
}
