"use client";
import { useEffect, useState } from "react";
import { useResearchLanguage } from "../use-research-language";
import PriceChart from "./price-chart";
import { compact, signedPercent, type Bar, type ChartRange } from "@/lib/research/market-quote";
import type { BoardQuote } from "@/lib/research/market-data";
import styles from "./board.module.css";

type Kind = "fx2" | "fx4" | "usd" | "etf";
type Entry = { id: string; ja: string; en: string; short: string; kind: Kind };
const INDEX_ETFS: (Entry & { sub: { ja: string; en: string } })[] = [
  { id: "SPY", ja: "S&P500に連動", en: "S&P 500", short: "SPY", kind: "etf", sub: { ja: "S&P500に連動", en: "tracks S&P 500" } },
  { id: "QQQ", ja: "NASDAQ100に連動", en: "NASDAQ 100", short: "QQQ", kind: "etf", sub: { ja: "NASDAQ100に連動", en: "tracks NASDAQ 100" } },
  { id: "DIA", ja: "NYダウに連動", en: "Dow", short: "DIA", kind: "etf", sub: { ja: "NYダウに連動", en: "tracks the Dow" } },
];
const CATEGORIES: { id: string; ja: string; en: string; items: Entry[] }[] = [
  { id: "fx", ja: "為替", en: "Forex", items: [
    { id: "USD/JPY", ja: "ドル円", en: "USD/JPY", short: "ドル円", kind: "fx2" }, { id: "EUR/JPY", ja: "ユーロ円", en: "EUR/JPY", short: "ユーロ円", kind: "fx2" },
    { id: "EUR/USD", ja: "ユーロドル", en: "EUR/USD", short: "ユーロドル", kind: "fx4" }, { id: "GBP/USD", ja: "ポンドドル", en: "GBP/USD", short: "ポンドドル", kind: "fx4" }] },
  { id: "crypto", ja: "暗号資産", en: "Crypto", items: [
    { id: "BTC/USD", ja: "ビットコイン", en: "Bitcoin", short: "BTC", kind: "usd" }, { id: "ETH/USD", ja: "イーサリアム", en: "Ethereum", short: "ETH", kind: "usd" },
    { id: "SOL/USD", ja: "ソラナ", en: "Solana", short: "SOL", kind: "usd" }, { id: "XRP/USD", ja: "リップル", en: "XRP", short: "XRP", kind: "usd" }] },
  { id: "metal", ja: "金属", en: "Metals", items: [
    { id: "XAU/USD", ja: "金", en: "Gold", short: "金", kind: "usd" }, { id: "XAG/USD", ja: "銀", en: "Silver", short: "銀", kind: "usd" },
    { id: "XCU/USD", ja: "銅", en: "Copper", short: "銅", kind: "usd" }, { id: "XPT/USD", ja: "プラチナ", en: "Platinum", short: "プラチナ", kind: "usd" }] },
  { id: "bond", ja: "債券ETF", en: "Bond ETFs", items: [
    { id: "SHY", ja: "SHY（1〜3年）", en: "SHY (1–3Y)", short: "SHY(1〜3年)", kind: "etf" }, { id: "IEF", ja: "IEF（7〜10年）", en: "IEF (7–10Y)", short: "IEF(7〜10年)", kind: "etf" },
    { id: "TLT", ja: "TLT（20年超）", en: "TLT (20+Y)", short: "TLT(20年超)", kind: "etf" }] },
  { id: "semi", ja: "半導体ETF", en: "Semiconductor ETFs", items: [
    { id: "SMH", ja: "SMH", en: "SMH", short: "SMH", kind: "etf" }, { id: "SOXX", ja: "SOXX", en: "SOXX", short: "SOXX", kind: "etf" }] },
];
const ALL = [...INDEX_ETFS, ...CATEGORIES.flatMap(c => c.items)];
const RANGES: ChartRange[] = ["1d", "1w", "1m", "3m", "1y", "5y"];
const RANGE_JA: Partial<Record<ChartRange, string>> = { "1d": "1日", "1w": "1週", "1m": "1ヵ月", "3m": "3ヵ月", "1y": "1年", "5y": "5年" };
const RANGE_EN: Partial<Record<ChartRange, string>> = { "1d": "1D", "1w": "1W", "1m": "1M", "3m": "3M", "1y": "1Y", "5y": "5Y" };

/** Prices the way the sheet writes them: yen pairs 154.32, other pairs 1.0842, dollars $98,420 / $3,215 / $182.4 / $2.41, ETFs 749.90. */
export function formatPrice(value: number, kind: Kind): string {
  if (kind === "fx2") return value.toFixed(2);
  if (kind === "fx4") return value.toFixed(4);
  if (kind === "etf") return value.toFixed(2);
  const a = Math.abs(value);
  return `$${a >= 1000 ? Math.round(value).toLocaleString("en-US") : a >= 100 ? value.toFixed(1) : value.toFixed(2)}`;
}
const toneOf = (value: number | null) => value === null || value === 0 ? "flat" : value > 0 ? "up" : "down";
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });

/** Reads quotes for the given ids now and every minute. A symbol the server cannot read is simply missing from the answer. */
function useBoard(ids: string[]) {
  const [state, setState] = useState<{ key: string; items: Record<string, BoardQuote> | null }>({ key: "", items: null });
  const key = ids.join(",");
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const response = await fetch(`/api/research/market/board?ids=${encodeURIComponent(key)}`, { cache: "no-store" }), body = await response.json();
        if (!stopped && response.ok && body.ok) setState({ key, items: Object.fromEntries((body.items as BoardQuote[]).map(item => [item.id, item])) });
        else if (!stopped) setState(old => ({ key, items: old.key === key ? old.items : {} }));
      } catch { if (!stopped) setState(old => ({ key, items: old.key === key ? old.items : {} })); }
      if (!stopped) timer = setTimeout(run, 60_000);
    };
    void run();
    return () => { stopped = true; clearTimeout(timer); };
  }, [key]);
  return state.key === key ? state.items : null;
}

export default function MarketBoard() {
  const [lang] = useResearchLanguage();
  const ja = lang === "ja";
  const [category, setCategory] = useState("fx");
  const [selected, setSelected] = useState("USD/JPY");
  const [range, setRange] = useState<ChartRange>("1m");
  const [mode, setMode] = useState<"candles" | "line">("line");
  const [chart, setChart] = useState<{ key: string; bars: Bar[]; before: Bar[] }>({ key: "", bars: [], before: [] });
  const [active, setActive] = useState<Bar | null>(null);
  const current = CATEGORIES.find(item => item.id === category)!;
  const indexQuotes = useBoard(INDEX_ETFS.map(item => item.id));
  const itemQuotes = useBoard(current.items.map(item => item.id));
  const entry = ALL.find(item => item.id === selected)!;
  const quote = indexQuotes?.[selected] ?? itemQuotes?.[selected];
  const key = `${selected}:${range}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/research/market/chart?ticker=${encodeURIComponent(selected)}&range=${range}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(body => { if (!controller.signal.aborted) setChart({ key, bars: body?.ok ? body.bars : [], before: body?.ok ? body.before ?? [] : [] }); })
      .catch(() => { if (!controller.signal.aborted) setChart({ key, bars: [], before: [] }); });
    return () => controller.abort();
  }, [selected, range, key]);
  const loading = chart.key !== key;
  const last = !loading && chart.bars.length ? chart.bars[chart.bars.length - 1] : null;
  const shownPrice = quote?.price ?? last?.close ?? null;
  const tone = toneOf(quote?.percentChange ?? null);
  const first = indexQuotes ? Object.values(indexQuotes)[0] : undefined;
  const interval = range === "1d" || range === "1w" ? "intraday" : range === "5y" ? "weekly" : "daily";
  const bar = active ?? last;
  const hasVolume = !loading && chart.bars.some(b => (b.volume ?? 0) > 0);
  const t = (a: string, b: string) => ja ? a : b;
  const num = (value: number) => formatPrice(value, entry.kind).replace(/^\$/, "");
  const pick = (id: string) => { setSelected(id); setActive(null); };
  return <div className={styles.wrap}>
    <section className={styles.indices} aria-label={t("主要3指数に連動するETF", "ETFs tracking the three major indices")}>
      <div className={styles.state} role="status">{first ? <><span className={styles.dot} data-open={first.marketOpen} /><span>{t(first.marketOpen ? "米国市場 取引中" : "米国市場 取引終了", first.marketOpen ? "U.S. market open" : "U.S. market closed")} ・ {clock(first.asOf)} JST</span></> : <span>{indexQuotes === null ? t("読み込み中…", "Loading…") : t("株価を取得できませんでした", "Prices unavailable")}</span>}</div>
      <div className={styles.cols}>{INDEX_ETFS.map(item => {
        const q = indexQuotes?.[item.id], tn = toneOf(q?.percentChange ?? null), ext = q?.extended;
        return <button type="button" key={item.id} className={styles.col} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setActive(null); }} aria-label={`${item.short} ${ja ? item.sub.ja : item.sub.en}`}>
          <span className={styles.colName}>{item.short}</span><span className={styles.colSub}>{ja ? item.sub.ja : item.sub.en}</span>
          <span className={styles.colPrice}>{q ? q.price.toFixed(1) : "—"}</span>
          <span className={`${styles.chip} ${styles[tn]}`}>{q?.percentChange == null ? "—" : `${tn === "up" ? "▲" : tn === "down" ? "▼" : "–"} ${signedPercent(q.percentChange)}`}</span>
          {ext && ext.percentChange !== null && <span className={`${styles.colExt} ${styles[toneOf(ext.percentChange)]}`}><small>{t("時間外 ", "Ext. ")}</small>{signedPercent(ext.percentChange)}</span>}
        </button>;
      })}</div>
    </section>
    <div className={styles.tabs} role="group" aria-label={t("種類", "Category")}>{CATEGORIES.map(item => <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => { setCategory(item.id); pick(item.items[0].id); }}>{ja ? item.ja : item.en}</button>)}</div>
    <div className={styles.items} style={{ gridTemplateColumns: `repeat(${current.items.length},minmax(0,1fr))` }}>{current.items.map(item => {
      const q = itemQuotes?.[item.id], tn = toneOf(q?.percentChange ?? null);
      return <button type="button" key={item.id} className={styles.item} aria-pressed={selected === item.id} onClick={() => pick(item.id)}>
        <span className={styles.itemName}>{item.short}</span><span className={styles.itemPrice}>{q ? formatPrice(q.price, item.kind) : "—"}</span>
        <span className={`${styles.itemChange} ${styles[tn]}`}>{q?.percentChange == null ? "" : signedPercent(q.percentChange)}</span></button>;
    })}</div>
    <section className={styles.panel} aria-label={ja ? entry.ja : entry.en}>
      <div className={styles.panelHead}><h2 className={styles.panelName}>{ja ? entry.ja : entry.en}</h2>
        <div className={styles.mode} role="group" aria-label={t("チャートの種類", "Chart type")}><button type="button" aria-pressed={mode === "candles"} onClick={() => setMode("candles")}>{t("ローソク足", "Candles")}</button><button type="button" aria-pressed={mode === "line"} onClick={() => setMode("line")}>{t("ライン", "Line")}</button></div></div>
      <div className={styles.big}><span className={styles.bigPrice}>{shownPrice === null ? "—" : formatPrice(shownPrice, entry.kind)}</span>
        {quote?.percentChange != null && <span className={`${styles.chip} ${styles[tone]}`} style={{ fontSize: 13 }}>{tone === "up" ? "▲" : tone === "down" ? "▼" : "–"} {signedPercent(quote.percentChange)}</span>}</div>
      {mode === "candles" && bar && <div className={styles.ohlc} aria-live="polite">
        <span><small>{t("始", "O")}</small>{num(bar.open)}</span><span><small>{t("高", "H")}</small>{num(bar.high)}</span><span><small>{t("安", "L")}</small>{num(bar.low)}</span><span><small>{t("終", "C")}</small>{num(bar.close)}</span>
        {hasVolume && bar.volume ? <span><small>{t("出来高", "Vol")}</small>{compact(bar.volume)}</span> : null}</div>}
      <div className={styles.chartBox}>{loading ? <p className={styles.note} role="status">{t("チャートを読み込み中…", "Loading the chart…")}</p>
        : chart.bars.length < 2 ? <p className={styles.note} role="status">{t("この銘柄のチャートを取得できませんでした。", "The chart for this symbol could not be loaded.")}</p>
        : <PriceChart bars={chart.bars} before={chart.before} mode={mode} interval={interval} variant="board" ja={ja} maPeriods={[25, 75]} accent="#7fe3c0" lineColor="#7fe3c0" onActive={setActive} />}</div>
      <div className={styles.ranges} role="group" aria-label={t("チャートの期間", "Chart range")}>{RANGES.map(r => <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>{(ja ? RANGE_JA : RANGE_EN)[r]}</button>)}</div>
    </section>
    <p className={styles.credit}>{t("提供：Twelve Data ・ SPY・QQQ・DIAと債券・半導体ETFはETFの価格です。上の3つを押すと、チャートがその銘柄に切り替わります。", "Data: Twelve Data. SPY, QQQ, DIA and the bond and semiconductor ETFs show ETF prices. Press one of the top three to chart it.")}</p>
  </div>;
}
