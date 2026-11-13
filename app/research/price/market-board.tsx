"use client";
import { useEffect, useRef, useState } from "react";
import { useResearchLanguage } from "../use-research-language";
import PriceChart from "./price-chart";
import { isExtendedBar, signedPercent, type Bar } from "@/lib/research/market-quote";
import { bannerLine, marketBanner, marketPhase } from "@/lib/research/us-market-session";
import { DEFAULT_PERIOD, OTHER_PERIODS, PERIOD_LABEL, PRIMARY_PERIODS, isBoardPeriod, isIntradayPeriod, periodInterval, type BoardPeriod } from "@/lib/research/market-board-periods";
import { nextFlash, startFlash } from "@/lib/research/value-flash";
import type { BoardQuote } from "@/lib/research/market-data";
import styles from "./board.module.css";

type Kind = "fx2" | "fx4" | "usd" | "etf";
type Entry = { id: string; ja: string; en: string; short: string; shortEn?: string; kind: Kind };
const INDEX_ETFS: (Entry & { sub: { ja: string; en: string } })[] = [
  { id: "SPY", ja: "S&P500に連動", en: "S&P 500", short: "SPY", kind: "etf", sub: { ja: "S&P500に連動", en: "tracks S&P 500" } },
  { id: "QQQ", ja: "NASDAQ100に連動", en: "NASDAQ 100", short: "QQQ", kind: "etf", sub: { ja: "NASDAQ100に連動", en: "tracks NASDAQ 100" } },
  { id: "DIA", ja: "NYダウに連動", en: "Dow", short: "DIA", kind: "etf", sub: { ja: "NYダウに連動", en: "tracks the Dow" } },
];
const CATEGORIES: { id: string; ja: string; en: string; items: Entry[] }[] = [
  { id: "fx", ja: "為替", en: "Forex", items: [
    { id: "USD/JPY", ja: "ドル円", en: "USD/JPY", short: "ドル円", shortEn: "USD/JPY", kind: "fx2" }, { id: "EUR/JPY", ja: "ユーロ円", en: "EUR/JPY", short: "ユーロ円", shortEn: "EUR/JPY", kind: "fx2" },
    { id: "EUR/USD", ja: "ユーロドル", en: "EUR/USD", short: "ユーロドル", shortEn: "EUR/USD", kind: "fx4" }, { id: "GBP/USD", ja: "ポンドドル", en: "GBP/USD", short: "ポンドドル", shortEn: "GBP/USD", kind: "fx4" }] },
  { id: "crypto", ja: "暗号資産", en: "Crypto", items: [
    { id: "BTC/USD", ja: "ビットコイン", en: "Bitcoin", short: "BTC", kind: "usd" }, { id: "ETH/USD", ja: "イーサリアム", en: "Ethereum", short: "ETH", kind: "usd" },
    { id: "SOL/USD", ja: "ソラナ", en: "Solana", short: "SOL", kind: "usd" }, { id: "XRP/USD", ja: "リップル", en: "XRP", short: "XRP", kind: "usd" }] },
  { id: "metal", ja: "金属", en: "Metals", items: [
    { id: "XAU/USD", ja: "金", en: "Gold", short: "金", shortEn: "Gold", kind: "usd" }, { id: "XAG/USD", ja: "銀", en: "Silver", short: "銀", shortEn: "Silver", kind: "usd" },
    { id: "XCU/USD", ja: "銅", en: "Copper", short: "銅", shortEn: "Copper", kind: "usd" }, { id: "XPT/USD", ja: "プラチナ", en: "Platinum", short: "プラチナ", shortEn: "Platinum", kind: "usd" }] },
  { id: "bond", ja: "債券ETF", en: "Bond ETFs", items: [
    { id: "SHY", ja: "SHY（1〜3年）", en: "SHY (1–3Y)", short: "SHY(1〜3年)", shortEn: "SHY (1–3Y)", kind: "etf" }, { id: "IEF", ja: "IEF（7〜10年）", en: "IEF (7–10Y)", short: "IEF(7〜10年)", shortEn: "IEF (7–10Y)", kind: "etf" },
    { id: "TLT", ja: "TLT（20年超）", en: "TLT (20+Y)", short: "TLT(20年超)", shortEn: "TLT (20+Y)", kind: "etf" }] },
  { id: "semi", ja: "半導体ETF", en: "Semi ETFs", items: [
    { id: "SMH", ja: "SMH", en: "SMH", short: "SMH", kind: "etf" }, { id: "SOXX", ja: "SOXX", en: "SOXX", short: "SOXX", kind: "etf" }] },
];
const ALL = [...INDEX_ETFS, ...CATEGORIES.flatMap(c => c.items)];
const STORE = "tp-market-board";
const FAST_MS = 15_000, SLOW_MS = 60_000;

/** Prices the way the sheet writes them: yen pairs 154.32, other pairs 1.0842, dollars $98,420 / $3,215 / $182.4 / $2.41, ETFs 749.90. */
export function formatPrice(value: number, kind: Kind): string {
  if (kind === "fx2") return value.toFixed(2);
  if (kind === "fx4") return value.toFixed(4);
  if (kind === "etf") return value.toFixed(2);
  const a = Math.abs(value);
  return `$${a >= 1000 ? Math.round(value).toLocaleString("en-US") : a >= 100 ? value.toFixed(1) : value.toFixed(2)}`;
}
const toneOf = (value: number | null) => value === null || value === 0 ? "flat" : value > 0 ? "up" : "down";

/** The current time, refreshed on every minute boundary (null until the page is on the screen, so the server page and the first paint agree). */
function useMinute() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => { const at = Date.now(); setNow(at); timer = setTimeout(tick, 60_000 - (at % 60_000) + 50); };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, []);
  return now;
}

/** Runs `task` now and then every `every` ms, but only while the tab is visible: a hidden tab asks for nothing, and asks again the moment it is shown. */
function startPolling(task: () => Promise<void>, every: number): () => void {
  let stopped = false, idle = false, timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    idle = false;
    await task();
    if (stopped) return;
    if (document.visibilityState === "hidden") { idle = true; return; }
    timer = setTimeout(run, every);
  };
  const shown = () => { if (!stopped && idle && document.visibilityState === "visible") void run(); };
  document.addEventListener("visibilitychange", shown);
  if (document.visibilityState === "hidden") idle = true; else void run();
  return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", shown); };
}

/** Reads quotes for the given ids now and every `every` ms (`fast`: the server keeps them 15 seconds, not a minute). A symbol the server cannot read is simply
 * missing from the answer. `at` is the time of the last successful read. */
function useBoard(ids: string[], every: number, fast: boolean) {
  const [state, setState] = useState<{ key: string; items: Record<string, BoardQuote> | null; at: number | null }>({ key: "", items: null, at: null });
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    return startPolling(async () => {
      try {
        const response = await fetch(`/api/research/market/board?ids=${encodeURIComponent(key)}${fast ? "&fast=1" : ""}`, { cache: "no-store" }), body = await response.json();
        if (response.ok && body.ok) setState({ key, items: Object.fromEntries((body.items as BoardQuote[]).map(item => [item.id, item])), at: Date.now() });
        else setState(old => old.key === key ? old : { key, items: {}, at: null });
      } catch { setState(old => old.key === key ? old : { key, items: {}, at: null }); }
    }, every);
  }, [key, every, fast]);
  return state.key === key ? { items: state.items, at: state.at } : { items: null, at: null };
}

/** A number that glows green when it rises and red when it falls (never on the first value, nor when `scope` changes). Reduced motion: a colour tint only (CSS). */
function useFlash(scope: string, value: number | null) {
  const [state, setState] = useState(() => startFlash(scope, value));
  const next = nextFlash(state, scope, value);
  if (next !== state) setState(next);
  return next;
}
const flashClass = (dir: "up" | "down" | null) => dir === "up" ? styles.flashUp : dir === "down" ? styles.flashDown : "";
function BigPrice({ scope, value, text }: { scope: string; value: number | null; text: string }) {
  const flash = useFlash(scope, value);
  return <span key={flash.n} className={`${styles.bigPrice} ${flashClass(flash.dir)}`}>{text}</span>;
}
function ExtLine({ id, ext, label }: { id: string; ext: NonNullable<BoardQuote["extended"]>; label: string }) {
  const flash = useFlash(id, ext.price);
  return <span key={flash.n} className={`${styles.colExt} ${styles[toneOf(ext.percentChange)]} ${flashClass(flash.dir)}`}><small>{label}</small>{signedPercent(ext.percentChange ?? 0)}</span>;
}

/** The "more" pull-down of the period buttons: the other candles and spans, the chosen one with a check mark and in mint. */
function MoreMenu({ period, onPick, ja }: { period: BoardPeriod; onPick: (period: BoardPeriod) => void; ja: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const chosen = OTHER_PERIODS.includes(period);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  const name = (p: BoardPeriod) => PERIOD_LABEL[p][ja ? "ja" : "en"];
  return <div className={styles.more} ref={box}>
    <button type="button" className={styles.moreButton} data-chosen={chosen} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>{chosen ? name(period) : ja ? "その他" : "More"} <span aria-hidden="true">{open ? "⌃" : "▾"}</span></button>
    {open && <div className={styles.menu} role="menu" aria-label={ja ? "そのほかの足と期間" : "More intervals and ranges"}>
      <p className={styles.menuHead}>{ja ? "そのほかの足と期間" : "More intervals and ranges"}</p>
      {OTHER_PERIODS.map(p => <button key={p} type="button" role="menuitemradio" aria-checked={period === p} className={styles.menuItem} onClick={() => { onPick(p); setOpen(false); }}>
        <span className={styles.menuName}>{name(p)}</span><span className={styles.menuCheck} aria-hidden="true">{period === p ? "✓" : ""}</span></button>)}
    </div>}
  </div>;
}

export default function MarketBoard() {
  const [lang] = useResearchLanguage();
  const ja = lang === "ja";
  const [category, setCategory] = useState("fx");
  const [selected, setSelected] = useState("USD/JPY");
  const [period, setPeriod] = useState<BoardPeriod>(DEFAULT_PERIOD);
  const [mode, setMode] = useState<"candles" | "line">("candles");
  const [chart, setChart] = useState<{ key: string; bars: Bar[]; before: Bar[] }>({ key: "", bars: [], before: [] });
  const [active, setActive] = useState<Bar | null>(null);
  // The last choices stay put (this browser only). The first time: 15 minutes.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as { category?: string; selected?: string; period?: string; mode?: "candles" | "line" } | null;
      if (!saved) return;
      const cat = CATEGORIES.find(item => item.id === saved.category);
      // Reads this browser's saved choices once after mount (reading them during render would not match the server's page).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (cat && (saved.selected === undefined || cat.items.some(item => item.id === saved.selected) || INDEX_ETFS.some(item => item.id === saved.selected))) { setCategory(cat.id); if (saved.selected) setSelected(saved.selected); }
      if (isBoardPeriod(saved.period)) setPeriod(saved.period);
      if (saved.mode === "candles" || saved.mode === "line") setMode(saved.mode);
    } catch { /* storage unavailable: the defaults stay */ }
  }, []);
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify({ category, selected, period, mode })); } catch { /* ignore */ } }, [category, selected, period, mode]);
  const current = CATEGORIES.find(item => item.id === category)!;
  const index = INDEX_ETFS.find(item => item.id === selected);
  // 15 seconds: the three index cards and the chart being looked at. Everything else on the board stays at a minute.
  const board = useBoard(INDEX_ETFS.map(item => item.id), FAST_MS, true);
  const watched = useBoard(index ? [] : [selected], FAST_MS, true);
  const rows = useBoard(current.items.map(item => item.id), SLOW_MS, false);
  const indexQuotes = board.items, itemQuotes = rows.items;
  const entry = ALL.find(item => item.id === selected)!;
  const quote = indexQuotes?.[selected] ?? watched.items?.[selected] ?? itemQuotes?.[selected];
  const key = `${selected}:${period}`;
  const [reload, setReload] = useState(0);
  const intraday = isIntradayPeriod(period);
  useEffect(() => {
    let have = false, controller = new AbortController();
    const stop = startPolling(async () => {
      controller = new AbortController();
      // The first read retries a provider blink quietly before an error is shown; a refresh keeps what is on the screen when it fails.
      for (let attempt = 0; attempt < (have ? 1 : 3); attempt++) {
        try {
          const response = await fetch(`/api/research/market/chart?ticker=${encodeURIComponent(selected)}&period=${period}`, { signal: controller.signal, cache: "no-store" });
          const body = response.ok ? await response.json() : null;
          if (body?.ok && body.bars.length) { have = true; setChart({ key, bars: body.bars, before: body.before ?? [] }); return; }
        } catch { if (controller.signal.aborted) return; }
        if (attempt < 2 && !have) await new Promise(done => setTimeout(done, 1200));
        if (controller.signal.aborted) return;
      }
      if (!have) setChart({ key, bars: [], before: [] });
    }, intraday ? FAST_MS : SLOW_MS);
    return () => { stop(); controller.abort(); };
  }, [selected, period, key, reload, intraday]);
  const loading = chart.key !== key;
  const ext = quote?.extended ?? null;
  const last = !loading && chart.bars.length ? chart.bars[chart.bars.length - 1] : null;
  const now = useMinute();
  const phase = marketPhase(new Date(now ?? 0)), banner = marketBanner(phase);
  const shownPrice = quote?.price ?? last?.close ?? null;
  const tone = toneOf(quote?.percentChange ?? null);
  const first = indexQuotes ? Object.values(indexQuotes)[0] : undefined;
  // On the 5 / 15 / 60 / 180-minute charts the panels and the volume are the regular session's (they agree with the price above, not with a 5-minute candle);
  // the crosshair switches them to the marked bar. The longer periods show the candle itself.
  const day: Bar | null = intraday && quote && quote.open != null && quote.high != null && quote.low != null ? { at: "session", open: quote.open, high: quote.high, low: quote.low, close: quote.price, volume: quote.volume } : null;
  const bar = active ?? day ?? last;
  // The band and the price tag of pre-market / after-hours: bands only on the intraday candles; the tag on every period. No extended bars in the data: the band alone.
  const trailingExtended = chart.bars.length > 0 && isExtendedBar(chart.bars[chart.bars.length - 1]);
  const extended = ext ? { label: ext.session === "pre" ? (ja ? "プレ" : "Pre") : (ja ? "アフター" : "After"), price: ext.price, close: quote?.price ?? ext.price, reserve: intraday && !trailingExtended } : undefined;

  const t = (a: string, b: string) => ja ? a : b;
  const num = (value: number) => formatPrice(value, entry.kind).replace(/^\$/, "");
  const pick = (id: string) => { setSelected(id); setActive(null); };
  const name = (p: BoardPeriod) => PERIOD_LABEL[p][ja ? "ja" : "en"];
  return <div className={styles.wrap}>
    <section className={styles.indices} aria-label={t("主要3指数に連動するETF", "ETFs tracking the three major indices")}>
      <div className={styles.state} role="status">{first ? <><span key={board.at} className={styles.dot} data-open={banner.lit} data-pulse={banner.lit ? "1" : undefined} /><span>{bannerLine(phase, ja, board.at)}</span></> : <span>{indexQuotes === null ? t("読み込み中…", "Loading…") : t("株価を取得できませんでした", "Prices unavailable")}</span>}</div>
      <div className={styles.cols}>{INDEX_ETFS.map(item => {
        const q = indexQuotes?.[item.id], tn = toneOf(q?.percentChange ?? null), itemExt = q?.extended;
        return <button type="button" key={item.id} className={styles.col} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setActive(null); }} aria-label={`${item.short} ${ja ? item.sub.ja : item.sub.en}`}>
          <span className={styles.colName}>{item.short}</span><span className={styles.colSub}>{ja ? item.sub.ja : item.sub.en}</span>
          <span className={styles.colPrice}>{q ? q.price.toFixed(1) : "—"}</span>
          <span className={`${styles.chip} ${styles[tn]}`}>{q?.percentChange == null ? "—" : `${tn === "up" ? "▲" : tn === "down" ? "▼" : "–"} ${signedPercent(q.percentChange)}`}</span>
          {itemExt && itemExt.percentChange !== null && <ExtLine id={item.id} ext={itemExt} label={t("時間外 ", "Ext. ")} />}
        </button>;
      })}</div>
    </section>
    <div className={styles.tabs} role="group" aria-label={t("種類", "Category")}>{CATEGORIES.map(item => <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => { setCategory(item.id); pick(item.items[0].id); }}>{ja ? item.ja : item.en}</button>)}</div>
    <div className={styles.items} style={{ gridTemplateColumns: `repeat(${current.items.length},minmax(0,1fr))` }}>{current.items.map(item => {
      const q = itemQuotes?.[item.id], tn = toneOf(q?.percentChange ?? null);
      return <button type="button" key={item.id} className={styles.item} aria-pressed={selected === item.id} onClick={() => pick(item.id)}>
        <span className={styles.itemName}>{ja ? item.short : item.shortEn ?? item.short}</span><span className={styles.itemPrice}>{q ? formatPrice(q.price, item.kind) : "—"}</span>
        <span className={`${styles.itemChange} ${styles[tn]}`}>{q?.percentChange == null ? "" : signedPercent(q.percentChange)}</span></button>;
    })}</div>
    <section className={styles.panel} aria-label={ja ? entry.ja : entry.en}>
      <div className={styles.panelHead}>{index
        ? <div className={styles.panelTitle}><h2 className={styles.panelName}>{index.short}</h2><span className={styles.panelSub}>{ja ? index.sub.ja : index.sub.en}</span></div>
        : <h2 className={styles.panelName}>{ja ? entry.ja : entry.en}</h2>}
        <div className={styles.mode} role="group" aria-label={t("チャートの種類", "Chart type")}><button type="button" aria-pressed={mode === "candles"} onClick={() => setMode("candles")}>{t("ローソク足", "Candles")}</button><button type="button" aria-pressed={mode === "line"} onClick={() => setMode("line")}>{t("ライン", "Line")}</button></div></div>
      <div className={styles.big}><BigPrice scope={selected} value={shownPrice} text={shownPrice === null ? "—" : formatPrice(shownPrice, entry.kind)} />
        {quote?.percentChange != null && <span className={`${styles.chip} ${styles[tone]}`} style={{ fontSize: 13 }}>{tone === "up" ? "▲" : tone === "down" ? "▼" : "–"} {signedPercent(quote.percentChange)}</span>}</div>
      {mode === "candles" && bar && <div className={styles.ohlc} aria-live="polite">
        <span><small>{t("始値", "Open")}</small><b>{num(bar.open)}</b></span><span><small>{t("高値", "High")}</small><b>{num(bar.high)}</b></span><span><small>{t("安値", "Low")}</small><b>{num(bar.low)}</b></span><span data-close="true"><small>{t("終値", "Close")}</small><b>{num(bar.close)}</b></span></div>}
      <div className={styles.chartBox}>{loading ? <p className={styles.note} role="status">{t("チャートを読み込み中…", "Loading the chart…")}</p>
        : chart.bars.length < 2 ? <p className={styles.note} role="status">{t("この銘柄のチャートを取得できませんでした。", "The chart for this symbol could not be loaded.")} <button type="button" className={styles.retry} onClick={() => { setChart({ key: "", bars: [], before: [] }); setReload(n => n + 1); }}>{t("もう一度読み込む", "Try again")}</button></p>
        : <PriceChart defaultVolume={day ? day.volume : undefined} bars={chart.bars} bands={intraday} jst={intraday} extended={extended} before={chart.before} mode={mode} interval={periodInterval(period)} variant="board" ja={ja} maPeriods={[25, 75]} accent="#7fe3c0" lineColor="#7fe3c0" onActive={setActive} />}</div>
      <div className={styles.ranges} role="group" aria-label={t("チャートの期間", "Chart range")}>{PRIMARY_PERIODS.map(p => <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>{name(p)}</button>)}
        <MoreMenu period={period} onPick={setPeriod} ja={ja} /></div>
    </section>
    <p className={styles.credit}>{t("提供：Twelve Data ・ SPY・QQQ・DIAと債券・半導体ETFはETFの価格です。上の3つを押すと、チャートがその銘柄に切り替わります。", "Data: Twelve Data. SPY, QQQ, DIA and the bond and semiconductor ETFs show ETF prices. Press one of the top three to chart it.")}</p>
  </div>;
}
