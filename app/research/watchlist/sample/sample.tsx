"use client";

import { useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../../research-tool-shell";
import { useResearchLanguage } from "../../use-research-language";
import StockLogo from "../stock-logo";
import { sparklinePoints } from "@/lib/research/favorite-lists";
import styles from "./sample.module.css";

// Deliberately synthetic presentation fixtures, never persisted or fed into quotes.
const samples = [
  { ticker: "MRVL", name: "Marvell", previous: 100, price: 103.25, pre: 104.08, path: [100, 100.8, 100.3, 101.4, 100.7, 101.9, 102.6, 102.1, 103.25] },
  { ticker: "CRDO", name: "Credo", previous: 80, price: 78.4, pre: 78.91, path: [80, 80.3, 79.8, 80.1, 79.2, 79.5, 78.8, 79, 78.4] },
  { ticker: "ANET", name: "Arista Networks", previous: 150, price: 153.6, pre: 152.99, path: [150, 150.4, 150.1, 151.2, 151.9, 151.3, 152.2, 153.1, 153.6] },
  { ticker: "MU", name: "Micron", previous: 200, price: 204.2, pre: 205.63, path: [200, 199.7, 201.1, 200.6, 201.9, 202.7, 202.1, 203.2, 204.2] },
];
const number = (n: number) => n.toFixed(2);
const signed = (n: number) => `${n > 0 ? "+" : ""}${number(n)}`;
export default function WatchlistSample() {
  const [lang, setLang] = useResearchLanguage();
  const [order, setOrder] = useState("saved");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState("");
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const rows = samples.filter(row => `${row.name} ${row.ticker}`.toLowerCase().includes(query.toLowerCase())).toSorted((a, b) => order === "gainers" ? (b.price / b.previous - a.price / a.previous) : order === "losers" ? (a.price / a.previous - b.price / b.previous) : samples.indexOf(a) - samples.indexOf(b));
  return <ResearchToolShell lang={lang} setLang={setLang} title={t("ウォッチリスト", "Watchlist")} description="" showHeading={false} showTools={false}>
    <div className={styles.page}>
      <header className={styles.heading}><h1>{t("ウォッチリスト", "Watchlist")}</h1><span>{t("マイリスト1", "My list 1")}</span></header>
      <p className={styles.notice}>{t("表示サンプル · 株価・値動きは架空データ", "Display sample · Simulated prices and trends")}</p>
      <div className={styles.controls}><input type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label={t("サンプル銘柄を絞り込み", "Filter sample stocks")} placeholder={t("銘柄を検索", "Find a stock")} /><select aria-label={t("並び順", "Sort order")} value={order} onChange={e => setOrder(e.target.value)}><option value="saved">{t("追加した順", "Date added")}</option><option value="gainers">{t("上昇率順", "Top gainers")}</option><option value="losers">{t("下落率順", "Top losers")}</option></select></div>
      <div className={styles.columns}><span>{t("銘柄", "Stock")}</span><span>{t("値動き", "Trend")}</span><span>{t("株価 USD", "Price USD")}</span><span>{t("前日比", "Change")}</span></div>
      <ul className={styles.rows}>{rows.map(row => {
        const change = row.price - row.previous, percent = change / row.previous * 100;
        const prePercent = (row.pre / row.price - 1) * 100;
        const points = sparklinePoints(row.path.map((price, i) => ({ price, at: new Date(Date.UTC(2026, 0, 1, 14, i * 5)).toISOString() })));
        const open = expanded === row.ticker;
        return <li key={row.ticker}>
          <button className={styles.row} aria-expanded={open} onClick={() => setExpanded(open ? "" : row.ticker)}>
            <span className={styles.identity}><StockLogo ticker={row.ticker} /><span><strong>{row.name}</strong><small>{row.ticker}</small></span></span>
            <svg className={styles.spark} data-up={percent >= 0} viewBox="0 0 100 40" role="img" aria-label={t(`${row.ticker}の架空の値動き`, `${row.ticker} simulated trend`)}><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="98" cy={points.split(" ").at(-1)?.split(",")[1]} r="2.5" fill="currentColor" /></svg>
            <span className={styles.price}>{number(row.price)}<small>{t("終値", "Close")}</small></span>
            <span className={styles.change} data-up={percent >= 0}><strong>{signed(percent)}%</strong><small>{signed(change)}</small></span>
          </button>
          <div className={styles.pre}><span>{t("プレ", "Pre")}</span><strong>{number(row.pre)}</strong><span data-up={prePercent >= 0}>{signed(prePercent)}%</span></div>
          {open && <div className={styles.detail}><svg viewBox="0 0 100 40" role="img" aria-label={t("拡大した架空チャート", "Expanded simulated chart")}><polyline points={points} fill="none" stroke="currentColor" strokeWidth=".7" /></svg><span>{t("架空データ · 実際の取引価格ではありません", "Simulated data · Not actual market prices")}</span></div>}
        </li>;
      })}</ul>
      {!rows.length && <p>{t("一致するサンプル銘柄がありません", "No matching sample stocks")}</p>}
      <footer className={styles.footer}><Link href="/research/watchlist">← {t("ウォッチリストへ", "Back to watchlist")}</Link><span>{t("本番のデータ提供予定：", "Planned live data provider: ")}<a href="https://twelvedata.com" target="_blank" rel="noopener noreferrer">Twelve Data</a></span></footer>
    </div>
  </ResearchToolShell>;
}
