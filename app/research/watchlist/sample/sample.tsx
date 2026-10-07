"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../../research-tool-shell";
import { useResearchLanguage } from "../../use-research-language";
import StockLogo from "../stock-logo";
import { searchStocks } from "@/lib/research/stock-search";
import styles from "./sample.module.css";

// Synthetic fixtures only. This page never reads or writes personal watchlists.
const samples = [
  { ticker: "MRVL", name: "Marvell", sector: { ja: "半導体", en: "Chips" }, previous: 100, price: 103.25, pre: 104.08, path: [100, 99.7, 99.95, 100.4, 100.15, 100.8, 100.5, 100.3, 100.65, 101.4, 101.05, 100.7, 101.15, 101.65, 101.4, 101.9, 102.2, 101.8, 102.6, 102.35, 102.1, 102.7, 102.5, 103.1, 102.85, 103.25] },
  { ticker: "CRDO", name: "Credo", sector: { ja: "半導体", en: "Chips" }, previous: 80, price: 78.4, pre: 78.91, path: [80, 80.15, 80.05, 80.3, 80.1, 79.95, 79.8, 80.05, 79.9, 80.1, 79.85, 79.45, 79.2, 79.4, 79.25, 79.5, 79.15, 79.3, 78.8, 78.95, 78.75, 79, 78.7, 78.55, 78.7, 78.4] },
  { ticker: "ANET", name: "Arista Networks", sector: { ja: "ネットワーク", en: "Networking" }, previous: 150, price: 153.6, pre: 152.99, path: [150, 149.8, 150.2, 150.4, 150.1, 150.5, 150.3, 150.7, 151.2, 150.95, 151.5, 151.9, 151.6, 151.3, 151.7, 151.5, 152.2, 152.6, 152.25, 152.8, 152.5, 153.1, 153.4, 153.15, 153.85, 153.6] },
  { ticker: "MU", name: "Micron", sector: { ja: "メモリ", en: "Memory" }, previous: 200, price: 204.2, pre: 205.63, path: [200, 200.3, 199.7, 200.1, 200.65, 201.1, 200.85, 200.6, 201.25, 200.95, 201.9, 201.6, 202.1, 202.7, 202.3, 202.1, 202.55, 202.85, 202.6, 203.2, 203.6, 203.25, 203.85, 204.4, 204.05, 204.2] },
];
type Session = "regular" | "pre" | "closed";
const number = (n: number) => n.toFixed(2);
const signed = (n: number) => `${n > 0 ? "+" : ""}${number(n)}`;
function quoteFor(row: typeof samples[number], session: Session) {
  const price = session === "pre" ? row.pre : row.price;
  const reference = session === "pre" ? row.price : row.previous;
  const change = price - reference;
  // A separate fictional pre-market series, anchored to the regular-session close.
  const path = session === "pre" ? [0, -.12, .08, .22, .15, .3, .2, .12, .24, .38, .31, .45, .3, .5, .42, .65, .56, .72, .63, .85, .76, .92, .84, 1.08, .96, 1].map(n => reference + change * n) : row.path;
  return { ...row, price, reference, change, percent: change / reference * 100, path };
}
function AreaChart({ values, reference, label }: { values: number[]; reference: number; label: string }) {
  const gradientId = useId();
  const changes = values.map(value => (value / reference - 1) * 100);
  const rawLow = Math.min(0, ...changes), rawHigh = Math.max(0, ...changes);
  const step = rawHigh - rawLow <= 1 ? .25 : rawHigh - rawLow <= 3 ? .5 : 1;
  const low = Math.floor(rawLow / step) * step;
  const high = Math.max(low + step, Math.ceil(rawHigh / step) * step);
  const y = (value: number) => 53 - (value - low) / (high - low) * 46;
  const coordinates = changes.map((value, i) => `${(4 + i * 192 / (changes.length - 1)).toFixed(2)},${y(value).toFixed(2)}`);
  const scale = (value: number) => `${value > 0 ? "+" : ""}${Number(value.toFixed(2))}%`;
  return <span className={styles.chartFrame}>
    <span className={styles.scale} aria-hidden="true"><span>{scale(high)}</span><span>{scale(low)}</span></span>
    <svg viewBox="0 0 200 60" preserveAspectRatio="none" role="img" aria-label={`${label} (${scale(low)} ～ ${scale(high)})`}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".32" /><stop offset="100%" stopColor="currentColor" stopOpacity=".015" /></linearGradient></defs>
      {[7, 30, 53].map(line => <line key={line} x1="0" x2="200" y1={line} y2={line} className={styles.grid} />)}
      <polygon points={`4,58 ${coordinates.join(" ")} 196,58`} fill={`url(#${gradientId})`} />
      <line x1="0" x2="200" y1={y(0)} y2={y(0)} className={styles.baseline} />
      <polyline points={coordinates.join(" ")} fill="none" stroke="currentColor" strokeOpacity=".6" strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <polyline points={coordinates.slice(-7).join(" ")} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx="196" cy={y(changes.at(-1)!)} r="5.5" fill="currentColor" opacity=".15" />
      <circle cx="196" cy={y(changes.at(-1)!)} r="2.7" fill="currentColor" />
    </svg>
  </span>;
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
            <span className={styles.identity}><StockLogo ticker={row.ticker} /><span className={styles.company}><strong>{row.name}</strong><small>{row.ticker}</small><span className={styles.sector}>{row.sector[lang]}</span></span></span>
            <span className={styles.trend} data-up={row.percent >= 0}><strong>{signed(row.percent)}%</strong><AreaChart values={row.path} reference={row.reference} label={t(`${row.ticker}の架空の値動き`, `${row.ticker} simulated trend`)} /></span>
            <span className={styles.price} data-direction={row.change > 0 ? "up" : row.change < 0 ? "down" : "flat"}>{number(row.price)}<small>{signed(row.change)} USD</small></span>
          </button>
          {open && <div className={styles.detail} data-up={row.percent >= 0}><div className={styles.detailHeading}><strong>{row.ticker} · {sessionLabel}</strong><span>{signed(row.percent)}%</span></div><AreaChart values={row.path} reference={row.reference} label={t("拡大した架空チャート", "Expanded simulated chart")} /><div className={styles.chartTimes}><span>{session === "pre" ? "04:00" : "09:30"}</span><span>{sampleTime.slice(0, 5)} ET</span></div><div className={styles.detailCaption}><span>{session === "pre" ? t("通常取引終値", "Regular close") : t("前営業日終値", "Previous close")} {number(row.reference)} USD</span><span>{t("架空データ", "Simulated data")}</span></div></div>}
        </li>;
      })}</ul>
      {!rows.length && <p>{t("一致するサンプル銘柄がありません", "No matching sample stocks")}</p>}
      <p className={styles.dataTime}>{t("データ時刻（架空）", "Data time (simulated)")} {sampleTime} ET · {t("株価のライブ更新なし", "Prices are not live")}</p>
      <footer className={styles.footer}><Link href="/research/watchlist">← {t("ウォッチリストへ", "Back to watchlist")}</Link><span>{t("本番のデータ提供予定：", "Planned live data provider: ")}<a href="https://twelvedata.com" target="_blank" rel="noopener noreferrer">Twelve Data</a></span></footer>
    </div>
  </ResearchToolShell>;
}
