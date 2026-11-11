"use client";
import { useEffect, useState } from "react";
import { useResearchLanguage } from "../use-research-language";
import { CHART_RANGES, type Bar, type ChartRange } from "@/lib/research/market-quote";
import PriceChart from "./price-chart";
import styles from "./detail.module.css";

const GROUPS = [
  { id: "index", ja: "指数", en: "Indices", items: [["SPX", "S&P 500", "S&P 500"], ["NDX", "NASDAQ 100", "NASDAQ 100"], ["DJI", "NYダウ", "Dow"]] },
  { id: "bond", ja: "債券ETF", en: "Bond ETFs", items: [["SHY", "SHY ・ 1〜3年", "SHY · 1–3Y"], ["IEF", "IEF ・ 7〜10年", "IEF · 7–10Y"], ["TLT", "TLT ・ 20年超", "TLT · 20+Y"]] },
  { id: "fx", ja: "為替", en: "Forex", items: [["USD/JPY", "USD / JPY", "USD / JPY"], ["EUR/USD", "EUR / USD", "EUR / USD"], ["EUR/JPY", "EUR / JPY", "EUR / JPY"]] },
] as const;
const RANGE_JA: Record<ChartRange, string> = { "1d": "1日", "1w": "1週", "1m": "1ヵ月", "3m": "3ヵ月", "6m": "6ヵ月", ytd: "年初来", "1y": "1年", "3y": "3年", "5y": "5年" };
const RANGE_EN: Record<ChartRange, string> = { "1d": "1D", "1w": "1W", "1m": "1M", "3m": "3M", "6m": "6M", ytd: "YTD", "1y": "1Y", "3y": "3Y", "5y": "5Y" };

/** The market page's charts (indices, bond ETFs, forex) from Twelve Data: the same candle / line chart as the stock detail page. */
export default function MarketChart() {
  const [lang] = useResearchLanguage();
  const ja = lang === "ja";
  const [group, setGroup] = useState<(typeof GROUPS)[number]["id"]>("index");
  const current = GROUPS.find(item => item.id === group)!;
  const [symbol, setSymbol] = useState<string>("SPX");
  const [range, setRange] = useState<ChartRange>("1m");
  const [mode, setMode] = useState<"candles" | "line">("candles");
  const [chart, setChart] = useState<{ key: string; bars: Bar[] }>({ key: "", bars: [] });
  const key = `${symbol}:${range}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/research/market/chart?ticker=${encodeURIComponent(symbol)}&range=${range}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(body => { if (!controller.signal.aborted) setChart({ key, bars: body?.ok ? body.bars : [] }); })
      .catch(() => { if (!controller.signal.aborted) setChart({ key, bars: [] }); });
    return () => controller.abort();
  }, [symbol, range, key]);
  const loading = chart.key !== key;
  return <section aria-label={ja ? "チャート" : "Charts"} style={{ margin: "0 0 18px" }}>
    <div className={styles.state} style={{ flexWrap: "wrap" }}>
      <div className={styles.mode} role="group" aria-label={ja ? "チャートの対象" : "Chart group"}>
        {GROUPS.map(item => <button key={item.id} type="button" aria-pressed={group === item.id} onClick={() => { setGroup(item.id); setSymbol(item.items[0][0]); }}>{ja ? item.ja : item.en}</button>)}
      </div>
      <div className={styles.mode} role="group" aria-label={ja ? "チャートの種類" : "Chart type"}>
        <button type="button" aria-pressed={mode === "candles"} onClick={() => setMode("candles")}>{ja ? "ローソク足" : "Candles"}</button>
        <button type="button" aria-pressed={mode === "line"} onClick={() => setMode("line")}>{ja ? "ライン" : "Line"}</button>
      </div>
    </div>
    <div className={styles.mode} role="group" aria-label={ja ? "銘柄" : "Symbol"} style={{ marginBottom: 10, display: "flex", overflowX: "auto" }}>
      {current.items.map(([id, labelJa, labelEn]) => <button key={id} type="button" aria-pressed={symbol === id} onClick={() => setSymbol(id)} style={{ whiteSpace: "nowrap" }}>{ja ? labelJa : labelEn}</button>)}
    </div>
    <div className={styles.chartWrap}>{loading ? <div className={styles.chartEmpty} role="status">{ja ? "チャートを読み込み中…" : "Loading the chart…"}</div> : <PriceChart bars={chart.bars} mode={mode} intraday={range === "1d" || range === "1w"} ja={ja} />}</div>
    <div className={styles.ranges} role="group" aria-label={ja ? "チャートの期間" : "Chart range"}>{CHART_RANGES.map(r => <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>{ja ? RANGE_JA[r] : RANGE_EN[r]}</button>)}</div>
    <p style={{ margin: 0, color: "#8f9bb0", fontSize: 12 }}>{ja ? "債券はETFの価格です。時間外を含みます。提供：Twelve Data" : "Bonds show ETF prices. Extended hours included. Data: Twelve Data"}</p>
  </section>;
}
