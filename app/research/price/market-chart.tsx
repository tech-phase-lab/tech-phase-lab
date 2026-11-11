"use client";
import { useEffect, useState } from "react";
import { useResearchLanguage } from "../use-research-language";
import { rangeChange, signedPercent, type Bar, type ChartRange } from "@/lib/research/market-quote";
import PriceChart from "./price-chart";
import styles from "./detail.module.css";

type Group = { id: string; ja: string; en: string; items: readonly (readonly [string, string, string])[] };
const GROUPS: Group[] = [
  { id: "index", ja: "指数", en: "Indices", items: [["DJI", "NYダウ", "Dow"], ["NDX", "NASDAQ100", "NASDAQ 100"], ["SPX", "S&P500", "S&P 500"]] },
  { id: "bond", ja: "債券ETF", en: "Bond ETFs", items: [["SHY", "SHY ・ 1〜3年", "SHY · 1–3Y"], ["IEF", "IEF ・ 7〜10年", "IEF · 7–10Y"], ["TLT", "TLT ・ 20年超", "TLT · 20+Y"]] },
  { id: "fx", ja: "為替", en: "Forex", items: [["USD/JPY", "USD / JPY", "USD / JPY"], ["EUR/USD", "EUR / USD", "EUR / USD"], ["EUR/JPY", "EUR / JPY", "EUR / JPY"]] },
];
const RANGES: ChartRange[] = ["1d", "1w", "1m", "3m", "1y", "5y"];
const RANGE_JA: Partial<Record<ChartRange, string>> = { "1d": "1日", "1w": "1週", "1m": "1ヵ月", "3m": "3ヵ月", "1y": "1年", "5y": "5年" };
const RANGE_EN: Partial<Record<ChartRange, string>> = { "1d": "1D", "1w": "1W", "1m": "1M", "3m": "3M", "1y": "1Y", "5y": "5Y" };

/** The market page's charts (indices through their ETFs, bond ETFs, forex) from Twelve Data: the design's G sheet. */
export default function MarketChart() {
  const [lang] = useResearchLanguage();
  const ja = lang === "ja";
  const [group, setGroup] = useState<string>("index");
  const [symbol, setSymbol] = useState<string>("SPX");
  // Which indices the provider really serves (the group is offered only when at least one is; an ETF price is not an index level).
  const [served, setServed] = useState<string[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/research/market/indices", { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(body => { if (!controller.signal.aborted) setServed(body?.ok ? body.items.map((item: { symbol: string }) => item.symbol) : []); }).catch(() => { if (!controller.signal.aborted) setServed([]); });
    return () => controller.abort();
  }, []);
  const groups = GROUPS.flatMap(item => item.id !== "index" ? [item] : served && served.length ? [{ ...item, items: item.items.filter(([id]) => served.includes(id)) }] : []);
  const current = groups.find(item => item.id === group) ?? groups[0];
  const active = current.items.some(([id]) => id === symbol) ? symbol : current.items[0][0];
  const [range, setRange] = useState<ChartRange>("1m");
  const [mode, setMode] = useState<"candles" | "line">("line");
  const [chart, setChart] = useState<{ key: string; bars: Bar[]; before: Bar[] }>({ key: "", bars: [], before: [] });
  const key = `${active}:${range}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/research/market/chart?ticker=${encodeURIComponent(active)}&range=${range}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(body => { if (!controller.signal.aborted) setChart({ key, bars: body?.ok ? body.bars : [], before: body?.ok ? body.before ?? [] : [] }); })
      .catch(() => { if (!controller.signal.aborted) setChart({ key, bars: [], before: [] }); });
    return () => controller.abort();
  }, [active, range, key]);
  const loading = chart.key !== key;
  const label = current.items.find(([id]) => id === active);
  const change = !loading && chart.bars.length ? rangeChange(chart.bars, null, range) : null;
  const last = !loading && chart.bars.length ? chart.bars[chart.bars.length - 1].close : null;
  const tone = change ? (change.percent >= 0 ? "up" : "down") : "flat";
  const interval = range === "1d" || range === "1w" ? "intraday" : range === "5y" ? "weekly" : "daily";
  return <section aria-label={ja ? "チャート" : "Charts"} className={styles.page} style={{ margin: "0 0 12px", gap: 14, paddingBottom: 0 }}>
    <div className={styles.pad} style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
      <div className={styles.mode} role="group" aria-label={ja ? "チャートの対象" : "Chart group"} style={{ margin: 0 }}>
        {groups.map(item => <button key={item.id} type="button" aria-pressed={current.id === item.id} onClick={() => { setGroup(item.id); setSymbol(item.items[0][0]); }}>{ja ? item.ja : item.en}</button>)}
      </div>
      <div className={styles.mode} role="group" aria-label={ja ? "チャートの種類" : "Chart type"} style={{ margin: 0 }}>
        <button type="button" aria-pressed={mode === "candles"} onClick={() => setMode("candles")}>{ja ? "ローソク足" : "Candles"}</button>
        <button type="button" aria-pressed={mode === "line"} onClick={() => setMode("line")}>{ja ? "ライン" : "Line"}</button>
      </div>
    </div>
    <div className={styles.pad} style={{ display: "flex", gap: 8, overflowX: "auto" }}>
      <div className={styles.mode} role="group" aria-label={ja ? "銘柄" : "Symbol"} style={{ margin: 0 }}>
        {current.items.map(([id, labelJa, labelEn]) => <button key={id} type="button" aria-pressed={active === id} onClick={() => setSymbol(id)}>{ja ? labelJa : labelEn}</button>)}
      </div>
    </div>
    <div className={styles.pad} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: 17, fontWeight: 800 }}>{label ? (ja ? label[1] : label[2]) : symbol}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 10, fontFamily: '"IBM Plex Mono",ui-monospace,monospace' }}>
        <span style={{ fontSize: 22, fontWeight: 700 }}>{last === null ? "—" : last.toFixed(active.includes("/") ? 3 : 2)}</span>
        <span className={styles[tone]} style={{ fontSize: 13, fontWeight: 600 }}>{change ? `${change.percent >= 0 ? "▲" : "▼"} ${signedPercent(change.percent)}` : ""}</span>
      </span>
    </div>
    {loading ? <div className={styles.pad}><p className={styles.error} style={{ padding: 0 }} role="status">{ja ? "チャートを読み込み中…" : "Loading the chart…"}</p></div> : <PriceChart bars={chart.bars} before={chart.before} mode={mode} interval={interval} variant="market" ja={ja} />}
    <div className={styles.ranges} style={{ ["--cols" as string]: 6 }} role="group" aria-label={ja ? "チャートの期間" : "Chart range"}>{RANGES.map(r => <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>{(ja ? RANGE_JA : RANGE_EN)[r]}</button>)}</div>
    <p className={styles.credit}>{ja ? "提供：Twelve Data ・ 債券はETFの価格です。時間外を含みます。" : "Data: Twelve Data. Bonds show ETF prices. Extended hours included."}</p>
  </section>;
}
