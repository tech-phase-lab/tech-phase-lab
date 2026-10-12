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

export default function CapitalMap({ portfolios = emptyPortfolios, mode = "sample" }: { portfolios?: CapitalPortfolio[]; mode?: "sample" | "reports" }) {
  const [lang, setLang] = useResearchLanguage();
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const { lists, editable } = useStockFavorites();
  const sample = portfolios.length > 0;
  const reported = mode === "reports";
  const [kind, setKind] = useState<"manager" | "etf" | "corporate">("manager");
  const [selectedId, setSelectedId] = useState(portfolios[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [watchOnly, setWatchOnly] = useState(false);
  const [comparison, setComparison] = useState<"period" | "visit">("period");
  const [changedOnly, setChangedOnly] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [message, setMessage] = useState("");
  const { saved, seen, ready, write } = useCapitalPreferences(portfolios.map(item => item.id), mode);
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
    : seen[selected.id] === selected.previous?.id ? selected.previous : undefined : undefined;
  const rows = selected ? capitalRows(selected.current, baseline) : [];
  const visibleRows = rows.filter(row => matches(row.ticker) && (!changedOnly || !["unchanged", "unknown"].includes(row.change)));
  const top = rows.filter(row => row.weight > 0).slice(0, 5);
  const topWeight = top.reduce((sum, row) => sum + row.weight, 0);
  const slices = [...top.map((row, index) => ({ weight: row.weight, color: colors[index] })), ...(topWeight < 100 ? [{ weight: 100 - topWeight, color: "#293844" }] : [])];
  const left = etfs.find(item => item.id === leftId);
  const right = etfs.find(item => item.id === rightId);
  const overlap = left && right && left.id !== right.id ? etfOverlap(left.current, right.current) : null;
  const holders = portfolios.flatMap(item => capitalRows(item.current).filter(row => row.shares > 0 && matches(row.ticker)).map(row => ({ ...row, portfolio: item })));
  const labels = { new: t("新規保有", "New"), increased: t("保有増加", "Increased"), reduced: t("保有減少", "Reduced"), exited: t("保有解消", "Exited"), unchanged: t("株数変化なし", "Shares unchanged"), unknown: t("比較未確認", "Not comparable") };
  function persist(nextSaved: string[], nextSeen: Record<string, string>) {
    setMessage(write(nextSaved, nextSeen) ? t("このブラウザーに保存しました", "Saved in this browser") : t("保存できませんでした。この画面内でのみ保持します。", "Could not save. Kept only in this session."));
  }
  function chooseKind(value: "manager" | "etf" | "corporate") { setKind(value); setSelectedId(portfolios.find(item => item.kind === value)?.id ?? ""); }

  return <ResearchToolShell lang={lang} setLang={setLang} title="CAPITAL MAP" description="" showHeading={false} showTools={false}>
    <div className={styles.page}>
      <header className={styles.heading}><div><p className={styles.eyebrow}>TECH PHASE RESEARCH</p><h1>CAPITAL MAP</h1><p>{t("運用会社・企業・ETFの投資先をひと目で。", "Manager, company and ETF investments, at a glance.")}</p></div><span className={styles.edition}>{reported ? t("SEC開示データ", "SEC DISCLOSURES") : sample ? t("表示サンプル", "DISPLAY SAMPLE") : t("PRO会員向け", "FOR PRO MEMBERS")}</span></header>
      {!sample ? <section className={styles.preparing}>
        <h2>{t("誰が、何を、どれだけ持っている？", "Who holds what, and how much?")}</h2>
        <p>{t("バークシャー、NVIDIA、Alphabetの13F開示を収録。PRO会員でログインすると全保有一覧を確認できます。", "Explore the complete reported 13F holdings of Berkshire, NVIDIA and Alphabet. Sign in with PRO to view disclosures.")}</p>
        <Link className={styles.primary} href="/research/account">{t("ログイン・プランを確認", "Sign in / View plan")} →</Link> <Link className={styles.primary} href="/research/capital-map/sample">{t("表示サンプルを見る", "Explore the display sample")} →</Link>
        <ul><li>{t("構成比と保有銘柄の変化", "Composition and holding changes")}</li><li>{t("銘柄入力・ウォッチリストで保有先を確認", "Find holders by ticker or watchlist")}</li><li>{t("追う運用会社・ETFの保存", "Follow managers and ETFs")}</li><li>{t("ETF同士の重複を確認", "Explore overlapping ETF holdings")}</li></ul>
        <p className={styles.footnote}>{t("収録範囲は2026年6月末の公開13Fです。未上場株や海外上場株など、開示対象外の資産は含みません。自動更新とETF実データは準備中です。", "Coverage: public June 2026 13F holdings. Assets outside 13F, including private and foreign-listed investments, are excluded. Automatic updates and live ETF data are in development.")}</p>
      </section> : <>
        <p className={styles.notice}>{reported ? t("2026年6月末のSEC 13F開示を収録。現在の全資産ではありません。自動更新は未稼働です。", "SEC 13F disclosures as of June 2026, not current total assets. Automatic updates are not running.") : t("すべて架空データ。実際の保有・取引・構成比を示すものではありません。", "All data is fictional. These are not actual holdings, trades or portfolio weights.")}</p>
        {!reported && <Link className={styles.primary} href="/research/capital-map">{t("バークシャー・NVIDIA・Googleの実際の開示を見る", "View actual Berkshire, NVIDIA and Google disclosures")} →</Link>}
        <nav className={styles.tabs} aria-label={t("投資先の種類", "Portfolio type")}><button aria-pressed={kind === "manager"} onClick={() => chooseKind("manager")}>{t("運用会社", "Managers")}</button>{portfolios.some(item => item.kind === "corporate") && <button aria-pressed={kind === "corporate"} onClick={() => chooseKind("corporate")}>{t("企業の保有株", "Corporate holdings")}</button>}{etfs.length > 0 && <button aria-pressed={kind === "etf"} onClick={() => chooseKind("etf")}>ETF</button>}<button className={styles.savedTab} aria-pressed={savedOnly} onClick={() => setSavedOnly(value => !value)}>{t("保存した対象", "Following")} {saved.length}</button></nav>
        <div className={styles.portfolios}>{visiblePortfolios.map(item => <button key={item.id} aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)}><strong>{item.name}</strong><small>{item.subtitle}</small>{seen[item.id] && seen[item.id] !== item.current.id && <span className={styles.update}>{t("更新あり", "Updated")}</span>}</button>)}{!visiblePortfolios.length && <p className={styles.empty}>{t("この種類で保存した対象はありません。", "No followed portfolios of this type.")}</p>}</div>
        <section className={styles.find} aria-labelledby="find-holders">
          <h2 id="find-holders">{t("この銘柄、誰が持っている？", "Who holds these stocks?")}</h2>
          <div className={styles.searchBar}><label><span>{t("ティッカーを入力", "Enter tickers")}</span><input value={query} maxLength={200} placeholder="NVDA, NBIS, AAPL" onChange={event => setQuery(event.target.value)} aria-invalid={invalidInput} /></label><button disabled={!editable} aria-pressed={watchOnly} onClick={() => setWatchOnly(value => !value)}>{t("ウォッチリストで絞る", "Filter by watchlist")}</button></div>
          {invalidInput && <p role="status">{t("銘柄名ではなく、NVDAのようなティッカーを入力してください。", "Enter ticker symbols such as NVDA, rather than company names.")}</p>}
          {watchOnly && !watched.size && <p className={styles.empty}>{t("ウォッチリストに登録銘柄がありません。", "Your watchlists are empty.")}</p>}
          <p className={styles.footnote}>{t("入力した銘柄は保存しません。絞り込みは全ウォッチリストを参照し、リストを変更しません。", "Ticker inputs are not saved. This filter reads all watchlists without changing them.")}</p>
          {(inputTickers.length > 0 || watchOnly) && <><div className={styles.holders}>{holders.map(row => <div key={`${row.portfolio.id}-${row.securityId}-${row.instrument}`}><div><strong>{row.ticker || `CUSIP ${row.securityId}`}{row.shareClass && ` · ${row.shareClass}`}{row.instrument !== "stock" && <b className={styles.option}>{row.instrument.toUpperCase()}</b>}</strong><small>{row.portfolio.name}</small></div><div><strong>{percent(row.weight)}</strong><small>{t("報告資産内", "of reported assets")}</small></div><div><strong>{row.companyPercent === null ? "—" : percent(row.companyPercent)}</strong><small>{t("企業の株式に対する保有率", "of company shares")}</small></div></div>)}</div>{!holders.length && <p className={styles.empty}>{t("収録データに該当情報はありません。保有者がいないという意味ではありません。", "No matches in the included data. This does not mean there are no holders.")}</p>}<p className={styles.footnote}>{t("企業の株式に対する保有率は未確認です。機関投資家全体の保有率は未対応です。", "Company ownership is unverified. Aggregate institutional ownership is not implemented.")}</p></>}
        </section>
        {selected && <section className={styles.portfolio} aria-labelledby="portfolio-name">
          <div className={styles.sectionHead}><div><h2 id="portfolio-name">{selected.name}</h2><p>{reported ? t("保有基準日", "As of") : t("架空の基準日", "Fictional as-of date")} {selected.current.asOf}<span> · {reported ? t("公表日", "Filed") : t("架空の公表日", "Fictional publication date")} {selected.current.publishedOn}</span></p></div><button className={styles.save} disabled={!ready} aria-pressed={saved.includes(selected.id)} onClick={() => persist(saved.includes(selected.id) ? saved.filter(id => id !== selected.id) : [...saved, selected.id], seen)}>{saved.includes(selected.id) ? "★ " : "☆ "}{t("追う", "Follow")}</button></div>
          <div className={styles.summary}><div className={styles.ring} role="img" aria-label={t("保有構成比。上位5銘柄とその他。全銘柄は下の一覧に表示。", "Composition: top five and other. All holdings are listed below.")}><svg viewBox="0 0 120 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><circle cx="60" cy="60" r="50" fill="none" stroke="#293844" strokeWidth="12" />{slices.map((slice, index) => <circle key={index} cx="60" cy="60" r="50" fill="none" stroke={slice.color} strokeWidth="12" pathLength="100" strokeDasharray={`${slice.weight} ${100 - slice.weight}`} strokeDashoffset={-slices.slice(0, index).reduce((sum, item) => sum + item.weight, 0)} transform="rotate(-90 60 60)" />)}</svg><div><small>{t("構成比", "COMPOSITION")}</small><strong>{selected.kind === "etf" ? selected.name : "13F"}</strong><small>{reported ? `${selected.current.holdings.length} ${t("銘柄", "securities")}` : t("架空データ", "FICTIONAL")}</small></div></div><ol className={styles.legend}>{top.map((row, index) => <li key={`${row.securityId}-${row.instrument}`}><span className={styles.swatch} style={{ background: colors[index] }} /><StockLogo ticker={row.ticker} /><div><strong>{row.name}</strong><small>{row.ticker || `CUSIP ${row.securityId}`}{row.shareClass && ` · ${row.shareClass}`}{row.instrument !== "stock" && ` · ${row.instrument.toUpperCase()}`}</small></div><b>{percent(row.weight)}</b></li>)}{topWeight < 99.999 && <li><span className={styles.swatch} style={{ background: "#293844" }} /><span /><div>{t("その他", "Other")}</div><b>{percent(100 - topWeight)}</b></li>}</ol></div>
          <p className={styles.footnote}>{selected.kind !== "etf" ? t("構成比は報告対象資産内の割合です。現金・未上場投資を含む全資産の割合ではありません。", "Weights are within reportable holdings, not total assets including cash and private investments.") : t("ETFの比率は基準日時点のものです。株価による比率の変化と保有株数の変化は区別します。", "ETF weights are as of the stated date. Price-driven weight changes are separate from share-count changes.")}</p>
          {selected.current.source && <div className={styles.source}><a href={selected.current.source.url} target="_blank" rel="noreferrer">{t("SEC保有明細", "SEC holdings table")}</a><a href={selected.current.source.coverUrl} target="_blank" rel="noreferrer">{t("SEC集計表", "SEC summary")}</a><p>{t("原本", "Source entries")} {selected.current.source.entryCount} {t("行を銘柄・株式クラスごとに集計。開示評価額の合計", "rows, aggregated by security and share class. Reported value")} ${selected.current.source.totalValue.toLocaleString("en-US")} · {t("確認日", "Reviewed")} {selected.current.source.checkedOn}</p><p>{t("13F対象の全銘柄を掲載しています。非公開保有分、未上場企業への出資、13F対象外の海外株は含みません。ティッカー未照合の銘柄はCUSIPで表示しています。", "All securities in this public 13F table are included. Confidential positions, private investments and foreign shares outside 13F are excluded. Unmatched tickers are identified by CUSIP.")}</p></div>}
          <h3 className={styles.listHeading}>{t("保有銘柄一覧", "All reported holdings")} · {selected.current.holdings.length} {t("銘柄", "securities")}</h3>
          {selected.previous ? <div className={styles.changeHead}><h3><select aria-label={t("変化の比較基準", "Change comparison basis")} value={comparison} onChange={event => setComparison(event.target.value as "period" | "visit")}><option value="period">{selected.kind !== "etf" ? t("前期からの変化", "Since the prior quarter") : t("前日からの変化", "Since the prior day")}</option><option value="visit">{t("前回確認からの変化", "Since my last check")}</option></select><small>{baseline?.asOf ?? t("未確認", "Not yet checked")}</small></h3><label><input type="checkbox" checked={changedOnly} onChange={event => setChangedOnly(event.target.checked)} />{t("株数が変わった銘柄だけ", "Share-count changes only")}</label></div> : <p className={styles.footnote}>{t("前期との比較は開示と株式分割等の照合後に追加します。現在は保有一覧を掲載しています。", "Quarterly comparisons will follow filing and corporate-action checks. This view currently lists reported holdings.")}</p>}
          {comparison === "visit" && !baseline && <p className={styles.footnote}>{t("前回の確認記録がありません。確認済みにすると次の更新との比較基準になります。", "No prior check is recorded. Mark this version as viewed to establish a baseline.")}</p>}
          <div className={styles.holdings}>{visibleRows.map(row => <div className={styles.holding} key={`${row.securityId}-${row.instrument}`}><StockLogo ticker={row.ticker} /><div className={styles.stock}><strong>{row.name}</strong><small>{row.ticker || `CUSIP ${row.securityId}`}{row.shareClass && ` · ${row.shareClass}`}{row.instrument !== "stock" && <b className={styles.option}>{row.instrument.toUpperCase()}</b>}</small></div><div className={styles.weight}><strong>{percent(row.weight)}</strong><small>{row.shares.toLocaleString("en-US")} {t("株相当", "reported units")}</small></div><div className={styles.change} data-change={row.change}><strong>{reported && !selected.previous ? t("開示評価額", "Reported value") : labels[row.change]}</strong><small>{reported && !selected.previous ? `$${row.value.toLocaleString("en-US")}` : row.shareChangePercent === null ? "—" : signed(row.shareChangePercent)}</small></div></div>)}{!visibleRows.length && <p className={styles.empty}>{t("この条件に該当する保有銘柄はありません。", "No holdings match these filters.")}</p>}</div>
          <div className={styles.visit}><span>{seen[selected.id] === selected.current.id ? t("この表示版を確認済み", "This version is marked as viewed") : seen[selected.id] ? t("前回の確認後に更新あり", "Updated since your last check") : t("この表示版は未確認", "This version has not been marked as viewed")}</span><button disabled={!ready || seen[selected.id] === selected.current.id} onClick={() => persist(saved, { ...seen, [selected.id]: selected.current.id })}>{t("確認済みにする", "Mark as viewed")}</button></div>{selected.previous && !reported && <button className={styles.simulate} disabled={!ready} onClick={() => persist(saved, { ...seen, [selected.id]: selected.previous!.id })}>{t("サンプル：前回の確認後に更新された状態を見る", "Sample: simulate an update since your last check")}</button>}
        </section>}
        {etfs.length >= 2 && <section className={styles.overlap} aria-labelledby="etf-overlap"><h2 id="etf-overlap">{t("ETFの中身、どれくらい重なる？", "How much do these ETFs overlap?")}</h2><div className={styles.compare}><select aria-label={t("比較するETF 1", "First ETF")} value={leftId} onChange={event => setLeftId(event.target.value)}>{etfs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span>×</span><select aria-label={t("比較するETF 2", "Second ETF")} value={rightId} onChange={event => setRightId(event.target.value)}>{etfs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{overlap && <strong>{percent(overlap.percent)}<small>{t("加重重複率 · 架空", "weighted overlap · fictional")}</small></strong>}</div>
          {!overlap ? <p className={styles.empty}>{t("異なるETFを選んでください。", "Choose two different ETFs.")}</p> : <><div className={styles.overlapBar}><span style={{ width: `${overlap.percent}%` }} /></div><div className={styles.overlapRows}>{overlap.rows.map(row => <div key={row.ticker}><strong>{row.ticker}</strong><span>{left?.name} {percent(row.left)}</span><span>{right?.name} {percent(row.right)}</span></div>)}</div><p className={styles.footnote}>{t("共通銘柄ごとに小さい方の構成比を合計します。あなたの保有金額を使った資産配分の計算ではありません。", "Sum of the smaller weight for each shared security, not an allocation calculation based on your invested amounts.")}</p></>}
        </section>}
        {reported && <Link className={styles.primary} href="/research/capital-map/sample">{t("ETF比較の架空サンプルを見る", "Explore the fictional ETF demo")} →</Link>}
        <p className={styles.storageNote}>{t("追う対象と確認済みの記録は、このブラウザーに保存します。アカウント・端末間の同期は未対応です。", "Following and viewed records are saved in this browser. Account and cross-device sync are not implemented.")}</p><p className={styles.message} role="status">{message}</p>
      </>}
    </div>
  </ResearchToolShell>;
}
