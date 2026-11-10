"use client";
import { useEffect, useState } from "react";
import { useResearchLanguage } from "../use-research-language";
import { jstClock } from "./use-market";
import { signedPercent } from "@/lib/research/market-quote";
import type { IndexQuote } from "@/lib/research/market-data";
import styles from "./price.module.css";

function Spark({ values, tone }: { values: number[]; tone: string }) {
  if (values.length < 2) return <div className={styles.spark} />;
  const low = Math.min(...values), high = Math.max(...values), span = high - low || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1) * 200).toFixed(1)},${(76 - (v - low) / span * 66).toFixed(1)}`);
  const color = tone === "up" ? "#4fe3a6" : tone === "down" ? "#ff7b7b" : "#9aa6bb";
  return <svg className={styles.spark} viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true">
    <polygon points={`0,80 ${points.join(" ")} 200,80`} fill={color} opacity=".14" /><polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" /></svg>;
}
/** NY Dow / NASDAQ 100 / S&P 500 in one panel, from Twelve Data (an ETF stands in, and says so, for an index the plan does not serve). */
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
  return <><section className={styles.indices} aria-label={ja ? "主要3指数" : "Three major indices"}>
    <div className={styles.status} role="status">{first ? <><span className={styles.dot} data-open={first.marketOpen} /><span>{ja ? (first.marketOpen ? "米国市場 取引中" : "米国市場 取引終了") : (first.marketOpen ? "U.S. market open" : "U.S. market closed")} ・ {jstClock(first.asOf)} JST</span></> : <span>{items === null && !failed ? (ja ? "指数を読み込み中…" : "Loading indices…") : (ja ? "指数を取得できませんでした" : "Indices unavailable")}</span>}</div>
    {items && <div className={styles.cols}>{items.map(item => {
      const tone = item.percentChange === null || item.percentChange === 0 ? "flat" : item.percentChange > 0 ? "up" : "down";
      return <div className={styles.col} key={item.id}>
        <h3>{ja ? item.ja : item.en}</h3>
        <strong>{item.value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong>
        <span className={styles.chip} data-tone={tone}>{tone === "up" ? "▲" : tone === "down" ? "▼" : "–"} {item.percentChange === null ? "—" : signedPercent(item.percentChange)}</span>
        {item.proxy && <span className={styles.proxy}>{ja ? `${item.proxy}（ETF）の値` : `via ${item.proxy} (ETF)`}</span>}
        <Spark values={item.line} tone={tone} />
      </div>;
    })}</div>}
  </section><p className={styles.credit}>{ja ? "提供：Twelve Data" : "Data: Twelve Data"}</p></>;
}
