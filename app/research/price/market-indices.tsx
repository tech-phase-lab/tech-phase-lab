"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useResearchLanguage } from "../use-research-language";
import { signedPercent } from "@/lib/research/market-quote";
import type { IndexQuote } from "@/lib/research/market-data";
import IndexStrip from "../market/index-strip";
import styles from "./price.module.css";

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
const toneOf = (value: number | null) => value === null || value === 0 ? "flat" : value > 0 ? "up" : "down";
/** NY Dow / NASDAQ 100 / S&P 500 in one frame, three columns (the design's D sheet). The prices are those of the ETFs that track them; the page says so
 * once, below. Pressing a column opens that index's full-screen page. */
export default function MarketIndices() {
  const [lang] = useResearchLanguage();
  const ja = lang === "ja";
  const [items, setItems] = useState<IndexQuote[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const response = await fetch("/api/research/market/indices", { cache: "no-store" }), body = await response.json();
        if (!stopped) { if (response.ok && body.ok) { setItems(body.items); setFailed(false); } else setFailed(true); }
      } catch { if (!stopped) setFailed(true); }
      if (!stopped) timer = setTimeout(run, 60_000);
    };
    void run();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  const first = items?.[0];
  // Real index values from Twelve Data when the contract serves them; until then (owner, Nov 11) the three indices come from the TradingView
  // reference quotes, labelled as such. An ETF price is never shown as an index level. Nothing is drawn while the first answer is awaited.
  if (!first) return items === null && !failed ? null : <IndexStrip lang={lang} />;
  return <><section className={styles.indices} aria-label={ja ? "主要3指数" : "Three major indices"}>
    <div className={styles.marketState} role="status">{first ? <><span className={styles.dot} data-open={first.marketOpen} /><span>{ja ? (first.marketOpen ? "米国市場 取引中" : "米国市場 取引終了") : (first.marketOpen ? "U.S. market open" : "U.S. market closed")} ・ {clock(first.asOf)} JST</span></> : <span>{items === null && !failed ? (ja ? "指数を読み込み中…" : "Loading indices…") : (ja ? "指数を取得できませんでした" : "Indices unavailable")}</span>}</div>
    {items && <div className={styles.cols}>{items.map(item => {
      const tone = toneOf(item.percentChange), ext = item.extended;
      return <Link className={styles.col} key={item.id} href={`/research/market/index/${item.id}`} aria-label={`${ja ? item.ja : item.en}`}>
        <span className={styles.colName}>{ja ? item.ja : item.en}</span>
        <span className={styles.colPrice}>{item.value.toFixed(1)}</span>
        <span className={`${styles.colChip} ${styles[tone]}`}>{tone === "up" ? "▲" : tone === "down" ? "▼" : "–"} {item.percentChange === null ? "—" : signedPercent(item.percentChange)}</span>
        {ext && ext.percentChange !== null && <span className={`${styles.colExt} ${styles[toneOf(ext.percentChange)]}`}><small>{ja ? "時間外 " : "Ext. "}</small>{signedPercent(ext.percentChange)}</span>}
      </Link>;
    })}</div>}
  </section><p className={styles.credit}>{ja ? "提供：Twelve Data" : "Data: Twelve Data"}</p></>;
}
