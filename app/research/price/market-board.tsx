"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useResearchLanguage } from "../use-research-language";
import PriceChart from "./price-chart";
import { useMinute, useSecond } from "./use-minute";
import { useChartStore } from "./use-chart-store";
import { startPolling } from "./polling";
import LeveragedList from "./leveraged-list";
import { signedPercent, type Bar } from "@/lib/research/market-quote";
import { bannerLine, closedDayClose, closedDayLine, freshnessNote, marketBanner, marketPhase } from "@/lib/research/us-market-session";
import { DEFAULT_PERIOD, OTHER_PERIODS, PERIOD_LABEL, PRIMARY_PERIODS, drawnSeries, isBoardPeriod, isIntradayPeriod, periodInterval, type BoardPeriod } from "@/lib/research/market-board-periods";
import { nextFlash, startFlash } from "@/lib/research/value-flash";
import type { BoardQuote } from "@/lib/research/market-data";
import styles from "./board.module.css";
import chartStyles from "./chart.module.css";

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
/** The last tab (owner, Nov 25): long 2x / 3x funds, a list of its own (app/research/price/leveraged-list.tsx) instead of the cards and chart. */
const LEVERAGED = { id: "lev", ja: "レバETF", en: "Leveraged ETFs" } as const;
/** The type switcher (owner, Nov 25): 3 columns × 2 rows of underline tabs, a small line icon beside each word. Row 1 為替・暗号資産・金属, row 2
 * 債券ETF・半導体ETF・レバETF. 24-unit strokes in currentColor, so the chosen tab's icon turns mint with its word. */
const TAB_ICONS: Record<string, ReactNode> = {
  fx: <path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4" />,
  crypto: <><circle cx="12" cy="12" r="8.5" /><path d="M10 7.5v9M10 8h3.2a2 2 0 0 1 0 4H10h3.6a2 2 0 0 1 0 4H10M12 6.5v1.5M12 16v1.5" /></>,
  metal: <path d="M7.5 8h9l3.5 9H4zM9.5 8l-1 9" />,
  bond: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" /></>,
  semi: <><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5" /></>,
  lev: <path d="M3.5 17l6-6 4 4 7-7.5M15 7.5h5.5V13" />,
};
function TabIcon({ id }: { id: string }) {
  return <svg className={styles.tabIcon} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{TAB_ICONS[id]}</svg>;
}
/** English words that do not fit their column at the regular size are drawn a little smaller, all six alike (never cut, never on two lines). */
function useFittedLabels(dep: string) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const group = box.current;
    if (!group) return;
    const fit = () => {
      group.style.removeProperty("--tab-font");
      let size = parseFloat(getComputedStyle(group).getPropertyValue("--tab-font-max")) || 13.5;
      const labels = [...group.querySelectorAll<HTMLElement>("[data-tab-label]")];
      const over = () => labels.some(label => { const button = label.parentElement!; return button.scrollWidth > button.clientWidth + 0.5; });
      while (over() && size > 9.5) { size -= 0.5; group.style.setProperty("--tab-font", `${size}px`); }
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(group);
    return () => watch.disconnect();
  }, [dep]);
  return box;
}
const STORE = "tp-market-board", SNAPSHOT_STORE = "tp-market-snapshot:v1";
const FAST_MS = 15_000, SLOW_MS = 60_000;

/** Prices the way the sheet writes them: yen pairs 154.32, other pairs 1.0842, dollars $98,420 / $3,215 / $182.4 / $2.41, ETFs 749.90. */
export function formatPrice(value: number, kind: Kind): string {
  if (kind === "fx2") return value.toFixed(2);
  if (kind === "fx4") return value.toFixed(4);
  if (kind === "etf") return value.toFixed(2);
  const a = Math.abs(value);
  return `$${a >= 1000 ? Math.round(value).toLocaleString("en-US") : a >= 100 ? value.toFixed(1) : value.toFixed(2)}`;
}
const toneOf = (value: number | null): "up" | "down" | "flat" => value === null || value === 0 ? "flat" : value > 0 ? "up" : "down";

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
type Snapshot = { quotes: Record<string, BoardQuote>; charts: Record<string, { bars: Bar[]; before: Bar[] }> };
/** Every tab's cards and first chart from the shared snapshot (owner, Nov 25: a tab not opened yet must show at once, like レバETF). Read once
 * when the page opens and every two minutes after; the provider is never asked for it (app/api/research/market/snapshot). */
function useMarketSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    // The copy this browser received last draws the page the moment it is ready, until the server's answer (or a read of its own) replaces it.
    try {
      const kept = JSON.parse(localStorage.getItem(SNAPSHOT_STORE) ?? "null") as Snapshot | null;
      // Read once after mount (reading it during render would not match the server's page).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (kept && typeof kept.quotes === "object" && typeof kept.charts === "object") setSnapshot(old => old ?? kept);
    } catch { /* storage unavailable or unreadable: wait for the server */ }
    return startPolling(async () => {
      try {
        const response = await fetch("/api/research/market/snapshot", { cache: "no-store" }), body = await response.json();
        if (!response.ok || !body.ok) return;
        const next: Snapshot = { quotes: body.quotes ?? {}, charts: body.charts ?? {} };
        setSnapshot(next);
        try { localStorage.setItem(SNAPSHOT_STORE, JSON.stringify(next)); } catch { /* full or blocked: the next visit waits for the server */ }
      } catch { /* the cards and chart are read as before */ }
    }, 120_000);
  }, []);
  return snapshot;
}
/** The live answer where there is one, the snapshot's copy for the rest; null while neither has anything (the loading word). */
function withSnapshot(ids: string[], live: Record<string, BoardQuote> | null, snapshot: Snapshot | null): Record<string, BoardQuote> | null {
  const kept = Object.fromEntries(ids.filter(id => !live?.[id] && snapshot?.quotes[id]).map(id => [id, snapshot!.quotes[id]]));
  if (live) return { ...kept, ...live };
  return Object.keys(kept).length ? kept : null;
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

/** The running clock of the status line (owner, Nov 24: "プレ取引中 ・ 22:23:50 JST" did not move). Its own component, so only these words
 * re-render every second, not the board and its chart. The age of the prices is said beside it when the reads have stopped, never by freezing it. */
function StatusClock({ ja, fetchedAt }: { ja: boolean; fetchedAt: number | null }) {
  const now = useSecond();
  const stale = freshnessNote(ja, fetchedAt, now);
  return <><span className={styles.clock}>{bannerLine(marketPhase(new Date(now ?? fetchedAt ?? 0)), ja, now)}</span>
    {stale && <span className={styles.stale} role="status">{stale}</span>}</>;
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
  const [active, setActive] = useState<Bar | null>(null);
  // The last choices stay put (this browser only). The first time: 15 minutes.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as { category?: string; selected?: string; period?: string; mode?: "candles" | "line" } | null;
      if (!saved) return;
      const cat = CATEGORIES.find(item => item.id === saved.category);
      // Reads this browser's saved choices once after mount (reading them during render would not match the server's page).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved.category === LEVERAGED.id) setCategory(LEVERAGED.id);
      else if (cat && (saved.selected === undefined || cat.items.some(item => item.id === saved.selected) || INDEX_ETFS.some(item => item.id === saved.selected))) { setCategory(cat.id); if (saved.selected) setSelected(saved.selected); }
      if (isBoardPeriod(saved.period)) setPeriod(saved.period);
      if (saved.mode === "candles" || saved.mode === "line") setMode(saved.mode);
    } catch { /* storage unavailable: the defaults stay */ }
  }, []);
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify({ category, selected, period, mode })); } catch { /* ignore */ } }, [category, selected, period, mode]);
  const lev = category === LEVERAGED.id;
  const current = CATEGORIES.find(item => item.id === category) ?? { id: LEVERAGED.id, ja: LEVERAGED.ja, en: LEVERAGED.en, items: [] as Entry[] };
  const index = INDEX_ETFS.find(item => item.id === selected);
  // 15 seconds: the three index cards and the chart being looked at. Everything else on the board stays at a minute.
  const board = useBoard(INDEX_ETFS.map(item => item.id), FAST_MS, true);
  const watched = useBoard(index || lev ? [] : [selected], FAST_MS, true);
  const rows = useBoard(current.items.map(item => item.id), SLOW_MS, false);
  const snapshot = useMarketSnapshot();
  const indexQuotes = withSnapshot(INDEX_ETFS.map(item => item.id), board.items, snapshot), itemQuotes = withSnapshot(current.items.map(item => item.id), rows.items, snapshot);
  const entry = ALL.find(item => item.id === selected)!;
  const quote = indexQuotes?.[selected] ?? watched.items?.[selected] ?? itemQuotes?.[selected];
  const key = `${selected}:${period}`;
  const [reload, setReload] = useState(0);
  const intraday = isIntradayPeriod(period);
  // Every series read is kept while the page is open (owner, Nov 15): a period picked again shows at once (and goes on refreshing), and while a new period
  // is on its way the chart of the same symbol stays on the screen with a small spinner at its top right.
  const store = useChartStore(key);
  const { put, fresh } = store;
  useEffect(() => {
    // The レバETF tab draws no chart: nothing is read for it.
    if (lev) return;
    let have = fresh(key), controller = new AbortController();
    const stop = startPolling(async () => {
      controller = new AbortController();
      // The first read retries a provider blink quietly before an error is shown; a refresh keeps what is on the screen when it fails.
      for (let attempt = 0; attempt < (have ? 1 : 3); attempt++) {
        try {
          const response = await fetch(`/api/research/market/chart?ticker=${encodeURIComponent(selected)}&period=${period}`, { signal: controller.signal, cache: "no-store" });
          const body = response.ok ? await response.json() : null;
          if (body?.ok && body.bars.length) { have = true; put(key, { bars: body.bars, before: body.before ?? [] }); return; }
        } catch { if (controller.signal.aborted) return; }
        if (attempt < 2 && !have) await new Promise(done => setTimeout(done, 1200));
        if (controller.signal.aborted) return;
      }
      if (!have && !fresh(key)) put(key, { bars: [], before: [], failed: true });
    }, intraday ? FAST_MS : SLOW_MS);
    return () => { stop(); controller.abort(); };
  }, [selected, period, key, reload, intraday, put, fresh, lev]);
  // Each tab's first chart (15 minutes) from the snapshot, until a read of its own arrives; a series already read is never replaced by it.
  useEffect(() => {
    if (!snapshot) return;
    for (const [id, series] of Object.entries(snapshot.charts)) if (!fresh(`${id}:${DEFAULT_PERIOD}`)) put(`${id}:${DEFAULT_PERIOD}`, series);
  }, [snapshot, put, fresh]);
  const loading = store.shown === null;
  const chart = store.shown ?? { bars: [], before: [] };
  // Until a new period comes, the chart on the screen is drawn with its own period's rules.
  const shownPeriod = (store.shownKey ? store.shownKey.slice(store.shownKey.lastIndexOf(":") + 1) : period) as BoardPeriod, shownIntraday = isIntradayPeriod(shownPeriod);
  // What is drawn (owner, Nov 14): the 15-minute chart shows the latest trading day only; intraday bad prints (a high / low 3% or more off the bar's body) are cut back.
  // Kept per series, so a zoomed chart is not reset on every render.
  const drawn = useMemo(() => drawnSeries(shownPeriod, store.shown ?? { bars: [], before: [] }), [store.shown, shownPeriod]);
  const last = !store.busy && chart.bars.length ? chart.bars[chart.bars.length - 1] : null;
  const now = useMinute();
  const phase = marketPhase(new Date(now ?? 0)), banner = marketBanner(phase);
  // Weekends and NYSE holidays (until the next pre-market): "休場 ・ 米国 11/13(金) の終値", a grey point, and no after-hours line under the cards (owner, Nov 15).
  const closedDay = now === null ? null : closedDayClose(new Date(now));
  const shownPrice = quote?.price ?? last?.close ?? null;
  const tone = toneOf(quote?.percentChange ?? null);
  const first = indexQuotes ? Object.values(indexQuotes)[0] : undefined;
  // On the 5 / 15 / 60 / 180-minute charts the panels and the volume are the regular session's (they agree with the price above, not with a 5-minute candle);
  // the crosshair switches them to the marked bar. The longer periods show the candle itself.
  const day: Bar | null = intraday && quote && quote.open != null && quote.high != null && quote.low != null ? { at: "session", open: quote.open, high: quote.high, low: quote.low, close: quote.price, volume: quote.volume } : null;
  const bar = active ?? day ?? last;

  const t = (a: string, b: string) => ja ? a : b;
  const num = (value: number) => formatPrice(value, entry.kind).replace(/^\$/, "");
  // The price tag on the right shows the big price above (owner, Nov 14); the mint band and its one word only while it is pre-market or after-hours now (intraday charts).
  const tag = shownPrice === null ? undefined : { price: shownPrice, text: num(shownPrice), tone };
  const pick = (id: string) => { setSelected(id); setActive(null); };
  const name = (p: BoardPeriod) => PERIOD_LABEL[p][ja ? "ja" : "en"];
  const tabs = useFittedLabels(lang);
  return <div className={styles.wrap}>
    <section className={styles.indices} aria-label={t("主要3指数に連動するETF", "ETFs tracking the three major indices")}>
      {/* Not a live region: a clock read aloud every second would drown a screen reader. Only the loading / failure words are announced. */}
      <div className={styles.state}>{first ? closedDay ? <><span className={styles.dot} data-closed="true" /><span>{closedDayLine(closedDay, ja)}</span></>
        : <><span key={board.at} className={styles.dot} data-open={banner.lit} data-pulse={banner.lit ? "1" : undefined} /><StatusClock ja={ja} fetchedAt={board.at} /></> : <span role="status">{indexQuotes === null ? t("読み込み中…", "Loading…") : t("株価を取得できませんでした", "Prices unavailable")}</span>}</div>
      <div className={styles.cols}>{INDEX_ETFS.map(item => {
        const q = indexQuotes?.[item.id], tn = toneOf(q?.percentChange ?? null), itemExt = q?.extended;
        return <button type="button" key={item.id} className={styles.col} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setActive(null); if (lev) setCategory(CATEGORIES[0].id); }} aria-label={`${item.short} ${ja ? item.sub.ja : item.sub.en}`}>
          <span className={styles.colName}>{item.short}</span><span className={styles.colSub}>{ja ? item.sub.ja : item.sub.en}</span>
          <span className={styles.colPrice}>{q ? q.price.toFixed(1) : "—"}</span>
          <span className={`${styles.chip} ${styles[tn]}`}>{q?.percentChange == null ? "—" : `${tn === "up" ? "▲" : tn === "down" ? "▼" : "–"} ${signedPercent(q.percentChange)}`}</span>
          {!closedDay && itemExt && itemExt.percentChange !== null && <ExtLine id={item.id} ext={itemExt} label={t("時間外 ", "Ext. ")} />}
        </button>;
      })}</div>
    </section>
    <div className={styles.tabs} ref={tabs} role="group" aria-label={t("種類", "Category")}>{CATEGORIES.map(item => <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => { setCategory(item.id); pick(item.items[0].id); }}><TabIcon id={item.id} /><span data-tab-label>{ja ? item.ja : item.en}</span></button>)}
      <button type="button" aria-pressed={lev} onClick={() => { setCategory(LEVERAGED.id); setActive(null); }}><TabIcon id={LEVERAGED.id} /><span data-tab-label>{ja ? LEVERAGED.ja : LEVERAGED.en}</span></button></div>
    {lev ? <LeveragedList ja={ja} /> : <>
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
      {mode === "candles" && !bar && loading && <div className={styles.ohlc} aria-hidden="true" style={{ visibility: "hidden" }}>{[0, 1, 2, 3].map(index => <span key={index}><small>&nbsp;</small><b>&nbsp;</b></span>)}</div>}
      {/* While the chart is on its way, its frame (and the OHLC row above) already hold their places, so the page does not grow when it arrives. */}
      <div className={styles.chartBox}>{loading ? <div>{mode === "candles" && <div className={chartStyles.legend} aria-hidden="true">&nbsp;</div>}<div className={`${chartStyles.frame} ${chartStyles.board}`} role="status"><span className={chartStyles.empty}>{t("チャートを読み込み中…", "Loading the chart…")}</span></div></div>
        : chart.bars.length < 2 ? <p className={styles.note} role="status">{t("この銘柄のチャートを取得できませんでした。", "The chart for this symbol could not be loaded.")} <button type="button" className={styles.retry} onClick={() => { store.drop(key); setReload(n => n + 1); }}>{t("もう一度読み込む", "Try again")}</button></p>
        : <PriceChart defaultVolume={day ? day.volume : undefined} bars={drawn.bars} jst={shownIntraday && ja} tag={tag} live={shownIntraday ? { phase } : undefined} sessionTicks={shownPeriod === "15m"} busy={store.busy} before={drawn.before} mode={mode} interval={periodInterval(shownPeriod)} variant="board" ja={ja} maPeriods={[25, 75]} accent="#7fe3c0" lineColor="#7fe3c0" onActive={setActive} />}</div>
      <div className={styles.ranges} role="group" aria-label={t("チャートの期間", "Chart range")}>{PRIMARY_PERIODS.map(p => <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>{name(p)}</button>)}
        <MoreMenu period={period} onPick={setPeriod} ja={ja} /></div>
    </section></>}
    <p className={styles.credit}>{lev ? t("提供：Twelve Data", "Data: Twelve Data") : t("提供：Twelve Data ・ SPY・QQQ・DIAと債券・半導体ETFはETFの価格です。上の3つを押すと、チャートがその銘柄に切り替わります。", "Data: Twelve Data. SPY, QQQ, DIA and the bond and semiconductor ETFs show ETF prices. Press one of the top three to chart it.")}</p>
  </div>;
}
