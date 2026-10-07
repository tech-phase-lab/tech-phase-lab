"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../../research-tool-shell";
import { useResearchLanguage } from "../../use-research-language";
import StockLogo from "../stock-logo";
import { searchStocks } from "@/lib/research/stock-search";
import styles from "./sample.module.css";

// Synthetic fixtures only. This page never reads or writes personal watchlists.
const samples = [
  { ticker: "MRVL", name: "Marvell", previous: 100, price: 103.25, pre: 104.08, path: [100, 100.8, 100.3, 101.4, 100.7, 101.9, 102.6, 102.1, 103.25] },
  { ticker: "CRDO", name: "Credo", previous: 80, price: 78.4, pre: 78.91, path: [80, 80.3, 79.8, 80.1, 79.2, 79.5, 78.8, 79, 78.4] },
  { ticker: "ANET", name: "Arista Networks", previous: 150, price: 153.6, pre: 152.99, path: [150, 150.4, 150.1, 151.2, 151.9, 151.3, 152.2, 153.1, 153.6] },
  { ticker: "MU", name: "Micron", previous: 200, price: 204.2, pre: 205.63, path: [200, 199.7, 201.1, 200.6, 201.9, 202.7, 202.1, 203.2, 204.2] },
];
type Session = "regular" | "pre" | "closed";
const number = (n: number) => n.toFixed(2);
const signed = (n: number) => `${n > 0 ? "+" : ""}${number(n)}`;
function quoteFor(row: typeof samples[number], session: Session) {
  const price = session === "pre" ? row.pre : row.price;
  const reference = session === "pre" ? row.price : row.previous;
  const change = price - reference;
  // A separate fictional pre-market series, anchored to the regular-session close.
  const path = session === "pre" ? [0, .2, .12, .38, .3, .65, .56, .85, 1].map(n => reference + change * n) : row.path;
  return { ...row, price, reference, change, percent: change / reference * 100, path };
}
function AreaChart({ values, reference, label }: { values: number[]; reference: number; label: string }) {
  const low = Math.min(reference, ...values), high = Math.max(reference, ...values);
  const y = (value: number) => high === low ? 24 : 43 - (value - low) / (high - low) * 36;
  const points = values.map((value, i) => `${3 + i * 154 / (values.length - 1)},${y(value)}`).join(" ");
  return <svg viewBox="0 0 160 48" preserveAspectRatio="none" role="img" aria-label={label}>
    {[12, 28, 44].map(line => <line key={line} x1="0" x2="160" y1={line} y2={line} className={styles.grid} />)}
    <polygon points={`3,47 ${points} 157,47`} fill="currentColor" opacity=".17" />
    <line x1="0" x2="160" y1={y(reference)} y2={y(reference)} className={styles.baseline} />
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    <circle cx="157" cy={y(values.at(-1)!)} r="2" fill="currentColor" />
  </svg>;
}
export default function WatchlistSample() {
  const [lang, setLang] = useResearchLanguage();
  const [order, setOrder] = useState("saved");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState("");
  const [session, setSession] = useState<Session>("regular");
  const [listIndex, setListIndex] = useState(0);
  const [names, setNames] = useState<string[]>(Array(7).fill(""));
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const updateClock = () => setNow(new Date());
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const listName = (index: number) => names[index] || t(`マイリスト${index + 1}`, `My list ${index + 1}`);
  const sessionLabel = session === "regular" ? t("取引中", "Market open") : session === "pre" ? t("プレマーケット", "Pre-market") : t("前日比", "Daily change");
  const sampleTime = session === "pre" ? "08:45:00" : session === "regular" ? "10:35:00" : "16:00:00";
  const rows = (query.trim() ? searchStocks(samples, query) : samples).map(row => quoteFor(row, session)).toSorted((a, b) => order === "gainers" ? b.percent - a.percent : order === "losers" ? a.percent - b.percent : samples.findIndex(s => s.ticker === a.ticker) - samples.findIndex(s => s.ticker === b.ticker));
  return <ResearchToolShell lang={lang} setLang={setLang} title={t("ウォッチリスト", "Watchlist")} description="" showHeading={false} showTools={false}>
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>{t("ウォッチリスト", "Watchlist")}</h1>
        <div className={styles.listPicker}><span aria-hidden="true">▼</span><select aria-label={t("マイリストを選択", "Choose list")} value={listIndex} onChange={e => { setListIndex(Number(e.target.value)); setRenaming(false); }}>
          {names.map((_, index) => <option key={index} value={index}>{listName(index)}</option>)}
        </select><button aria-label={t("リスト名を編集", "Edit list name")} aria-expanded={renaming} onClick={() => { setDraftName(listName(listIndex)); setRenaming(!renaming); }}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" /></svg></button></div>
      </header>
      <p className={styles.notice}>{t("表示サンプル · 架空データ／リスト操作はこの画面内のみ", "Display sample · Simulated data / list edits stay on this page")}</p>
      {renaming && <form className={styles.renameForm} onSubmit={e => { e.preventDefault(); if (!draftName.trim()) return; setNames(current => current.map((name, index) => index === listIndex ? draftName.trim() : name)); setRenaming(false); }}><input autoFocus aria-label={t("リスト名", "List name")} maxLength={40} required value={draftName} onChange={e => setDraftName(e.target.value)} /><button type="submit">{t("保存", "Save")}</button><button type="button" onClick={() => setRenaming(false)}>{t("取消", "Cancel")}</button></form>}
      <div className={styles.controls}><input type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label={t("サンプル銘柄を絞り込み", "Filter sample stocks")} placeholder={t("銘柄を検索", "Find a stock")} /><select aria-label={t("並び順", "Sort order")} value={order} onChange={e => setOrder(e.target.value)}><option value="saved">{t("追加した順", "Date added")}</option><option value="gainers">{t("上昇率順", "Top gainers")}</option><option value="losers">{t("下落率順", "Top losers")}</option></select></div>
      <div className={styles.marketBar}><label><span>{t("表示例", "Preview")}</span><select aria-label={t("取引時間帯の表示例", "Preview market session")} value={session} onChange={e => setSession(e.target.value as Session)}><option value="regular">{t("取引中", "Market open")}</option><option value="pre">{t("プレ", "Pre-market")}</option><option value="closed">{t("取引時間外", "Market closed")}</option></select></label><span>{t("現在", "Now")} <time dateTime={now?.toISOString()}>{now ? now.toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour12: false }) : "—"}</time> JST</span></div>
      <div className={styles.columns}><span>{t("銘柄", "Stock")}</span><span>{sessionLabel}</span><span>{t("株価 USD", "Price USD")}</span></div>
      <ul className={styles.rows}>{rows.map(row => {
        const open = expanded === row.ticker;
        return <li key={row.ticker}>
          <button className={styles.row} aria-expanded={open} onClick={() => setExpanded(open ? "" : row.ticker)}>
            <span className={styles.identity}><StockLogo ticker={row.ticker} /><span><strong>{row.name}</strong><small>{row.ticker}</small></span></span>
            <span className={styles.trend} data-up={row.percent >= 0}><strong>{signed(row.percent)}%</strong><AreaChart values={row.path} reference={row.reference} label={t(`${row.ticker}の架空の値動き`, `${row.ticker} simulated trend`)} /></span>
            <span className={styles.price} data-direction={row.change > 0 ? "up" : row.change < 0 ? "down" : "flat"}>{number(row.price)}<small>{signed(row.change)} USD</small></span>
          </button>
          {open && <div className={styles.detail} data-up={row.percent >= 0}><div className={styles.detailHeading}><strong>{row.ticker} · {sessionLabel}</strong><span>{signed(row.percent)}%</span></div><AreaChart values={row.path} reference={row.reference} label={t("拡大した架空チャート", "Expanded simulated chart")} /><div className={styles.detailCaption}><span>{session === "pre" ? t("通常取引終値", "Regular close") : t("前営業日終値", "Previous close")} {number(row.reference)} USD</span><span>{t("架空データ", "Simulated data")}</span></div></div>}
        </li>;
      })}</ul>
      {!rows.length && <p>{t("一致するサンプル銘柄がありません", "No matching sample stocks")}</p>}
      <p className={styles.dataTime}>{t("データ時刻（架空）", "Data time (simulated)")} {sampleTime} ET · {t("株価のライブ更新なし", "Prices are not live")}</p>
      <footer className={styles.footer}><Link href="/research/watchlist">← {t("ウォッチリストへ", "Back to watchlist")}</Link><span>{t("本番のデータ提供予定：", "Planned live data provider: ")}<a href="https://twelvedata.com" target="_blank" rel="noopener noreferrer">Twelve Data</a></span></footer>
    </div>
  </ResearchToolShell>;
}
