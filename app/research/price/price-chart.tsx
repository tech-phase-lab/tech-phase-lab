"use client";
import { useEffect, useRef, useState } from "react";
import { movingAverages, plain, compact, easternToIso, isExtendedBar, type Bar } from "@/lib/research/market-quote";
import { liveBand, sessionTicks } from "@/lib/research/market-board-periods";
import styles from "./chart.module.css";

const W = 390, PR = 50;
const UP = "#4fe3a6", DOWN = "#ff7b7b", GOLD = "#f3d98b";
export const MA_STYLE = [{ period: 5, color: "#f3d98b", ja: "短期", en: "Short" }, { period: 25, color: "#8fb0ff", ja: "中期", en: "Mid" }, { period: 75, color: "#c3a6ff", ja: "長期", en: "Long" }] as const;
const jstParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** A bar's New York time ("2026-11-12 15:55:00") as Japan time in the same shape; unchanged when it is not a datetime. */
function jstText(at: string): string {
  const iso = easternToIso(at);
  if (!iso) return at;
  const p = Object.fromEntries(jstParts.formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:00`;
}
const axis = (value: number) => Math.abs(value) >= 10000 ? `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}K` : Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 10 ? value.toFixed(2) : value.toFixed(4);

/** The chart of the design's F and G sheets: candles (or an area line), volume bars, moving averages, thin grid, a gold crosshair with price
 * and date tags on the axes. `detail` is 390×350 with volume; `market` is 390×260 without. Everything is drawn in a 390-wide frame that scales. */
export default function PriceChart(props: ChartProps) {
  const { bars, before = [] } = props;
  const [saved, setSaved] = useState<{ of: Bar[]; start: number; len: number } | null>(null);
  const win = saved && saved.of === bars ? saved : null; // a new series (other symbol or range) starts unzoomed
  const setWin = (next: { start: number; len: number } | null) => setSaved(next && { of: bars, ...next });
  const total = bars.length, len = Math.min(win?.len ?? total, total), start = Math.max(0, Math.min(win?.start ?? 0, total - len));
  const zoomed = len < total;
  const zoom = (ratio: number, center: number, shift = 0) => {
    // Pinch: `ratio` > 1 spreads the fingers (fewer bars). `center` is the 0–1 place under the fingers; it stays under them. `shift` pans by that fraction of the view.
    const next = Math.max(Math.min(12, total), Math.min(total, Math.round(len / ratio)));
    if (next >= total) { setWin(null); return; }
    const anchor = start + center * len, from = Math.round(anchor - center * next - shift * len);
    setWin({ start: Math.max(0, Math.min(from, total - next)), len: next });
  };
  // The band of the extended hours under way (board): found on the whole series, drawn on the part in view; its empty stretch at the right end (no bar of
  // that part yet) only while the view reaches the last bar.
  const band = props.live ? liveBand(bars, props.live.phase, props.ja) : null;
  const view = band && band.from < start + len ? { from: Math.max(0, band.from - start), label: band.label, reserve: band.from === total && start + len === total } : null;
  return <ChartBody {...props} band={view} bars={bars.slice(start, start + len)} before={[...before, ...bars.slice(0, start)]} zoomed={zoomed} onZoom={zoom} onReset={() => setWin(null)} />;
}
type ChartProps = {
  bars: Bar[]; before?: Bar[]; mode: "candles" | "line"; interval: "intraday" | "daily" | "weekly"; variant?: "detail" | "market" | "board"; ja: boolean;
  /** Moving averages to draw (default 5 / 25 / 75); the market board uses 25 / 75. */ maPeriods?: readonly number[];
  /** The crosshair and its tags (gold on the stock pages, mint on the market board). */ accent?: string; lineColor?: string;
  /** Pre-market and after-hours bars (those outside 9:30–16:00 New York time) are set apart in thin bands, each labelled "Pre" / "After". */
  bands?: boolean;
  /** Axis times in Japan time (the bars come in New York time). */
  jst?: boolean;
  /** The price tag on the right axis (the market board: the same value as the big price above the chart), green / red / grey by the day's change.
   * Axis numbers it would cover are hidden. */
  tag?: { price: number; text?: string; tone: "up" | "down" | "flat" };
  /** The market board: the current market phase. Only while it is "pre" or "post" the extended-hours part on the right gets a mint band and one word. */
  live?: { phase: string };
  /** Axis times only where pre-market, the session and after-hours begin (the board's 15-minute chart). */
  sessionTicks?: boolean;
  /** The volume shown while no bar is marked, when it is not the last bar's (the market board shows the session's volume). */
  defaultVolume?: number | null;
  /** Called with the bar under the crosshair (or null), so a header can show its open / high / low / close / volume. */ onActive?: (bar: Bar | null) => void };
function ChartBody({ bars, before = [], mode, interval, variant = "detail", ja, maPeriods, accent = GOLD, lineColor, bands, jst, tag, band, sessionTicks: bySession, defaultVolume, onActive, zoomed, onZoom, onReset }: ChartProps & { band: { from: number; label: string; reserve: boolean } | null; zoomed: boolean; onZoom: (ratio: number, center: number, shift?: number) => void; onReset: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const touches = useRef(new Map<number, number>()), pinch = useRef<{ gap: number; mid: number } | null>(null);
  const board = variant === "board";
  const H = variant === "detail" ? 350 : board ? 300 : 260, PT = variant === "detail" ? 30 : 24, PB = variant === "detail" ? 250 : board ? 224 : 232, VB = board ? 276 : 324, VH = board ? 44 : 52, SEP = board ? 232 : 258;
  // A series with no volume figures (forex) has no volume bars and no volume label.
  const withVolume = variant !== "market" && bars.some(b => (b.volume ?? 0) > 0);
  const priceBottom = withVolume || variant !== "board" ? PB : 268;
  const [cross, setCross] = useState<number | null>(null);
  // A tap anywhere outside the chart puts the crosshair away.
  useEffect(() => {
    if (cross === null) return;
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setCross(null); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [cross]);
  useEffect(() => { onActive?.(cross === null ? null : bars[cross] ?? null); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cross]);
  if (bars.length < 2) return <div className={`${styles.frame} ${variant === "detail" ? styles.detail : board ? styles.board : styles.market}`} role="status"><span className={styles.empty}>{ja ? "チャートのデータがありません" : "No chart data"}</span></div>;
  const n = bars.length, pw = W - PR, extPrice = tag ? [tag.price] : [];
  const lo0 = Math.min(...bars.map(b => mode === "candles" ? b.low : b.close), ...extPrice), hi0 = Math.max(...bars.map(b => mode === "candles" ? b.high : b.close), ...extPrice);
  // Runs of consecutive bars outside the regular session (one day's pre-market, one day's after-hours) become bands.
  const runs: { from: number; to: number; pre: boolean }[] = [];
  if (bands) bars.forEach((b, k) => { if (!isExtendedBar(b)) return; const pre = Number(b.at.slice(11, 13)) * 60 + Number(b.at.slice(14, 16)) < 570, last = runs[runs.length - 1]; if (last && last.to === k - 1 && last.pre === pre && bars[last.from].at.slice(0, 10) === b.at.slice(0, 10)) last.to = k; else runs.push({ from: k, to: k, pre }); });
  const reserve = band?.reserve ? Math.ceil(n * 0.16) : 0, slots = n + reserve;
  const pad = (hi0 - lo0 || hi0 * 0.02) * (variant === "detail" ? 0.08 : 0.1), lo = lo0 - pad, hi = hi0 + pad, step = pw / slots, bw = Math.max(1.2, Math.min(14, step * 0.62));
  const X = (k: number) => step * (k + 0.5), Y = (v: number) => PT + (hi - v) / (hi - lo) * (priceBottom - PT);
  const rising = bars[n - 1].close >= bars[0].close;
  const grid = [0, 1, 2, 3].map(i => { const v = hi - (hi - lo) * (i + 0.5) / 4; return { y: Y(v), label: axis(v) }; });
  const ticks = bySession ? sessionTicks(bars, before[before.length - 1]).filter((tick, k, all) => !k || step * (tick.index - all[k - 1].index) >= 34) : null;
  const dateIdx = ticks ? [] : (interval === "intraday" && jst && bars[0].at.slice(0, 10) !== bars[n - 1].at.slice(0, 10) ? [0.12, 0.37, 0.62, 0.87] : [0.1, 0.3, 0.5, 0.7, 0.9]).map(f => Math.min(n - 1, Math.round(n * f)));
  const local = (at: string) => jst && interval === "intraday" ? jstText(at) : at;
  const label = (raw: string) => { const at = local(raw); return interval === "intraday" ? (local(bars[0].at).slice(0, 10) === local(bars[n - 1].at).slice(0, 10) ? at.slice(11, 16) : `${Number(at.slice(5, 7))}/${Number(at.slice(8, 10))} ${at.slice(11, 16)}`)
    : interval === "weekly" ? `${at.slice(2, 4)}/${Number(at.slice(5, 7))}` : `${Number(at.slice(5, 7))}/${Number(at.slice(8, 10))}`; };
  const vmax = Math.max(...bars.map(b => b.volume ?? 0), 1);
  const styleOf = MA_STYLE.filter(m => !maPeriods || maPeriods.includes(m.period));
  const ma = mode === "candles" ? movingAverages(before, bars, styleOf.map(m => m.period)) : [];
  const maPath = (series: (number | null)[]) => series.map((v, k) => v === null ? "" : `${k && series[k - 1] !== null ? "L" : "M"}${X(k).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const indexAt = (event: React.PointerEvent) => { const rect = box.current!.getBoundingClientRect(); return Math.max(0, Math.min(n - 1, Math.floor((event.clientX - rect.left) / rect.width * W / step))); };
  const at = (event: React.PointerEvent) => { if (touches.current.size < 2) setCross(indexAt(event)); };
  const down = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse") { at(event); return; }
    touches.current.set(event.pointerId, event.clientX);
    if (touches.current.size === 2) { const [a, b] = [...touches.current.values()]; const rect = box.current!.getBoundingClientRect(); pinch.current = { gap: Math.abs(a - b), mid: ((a + b) / 2 - rect.left) / rect.width }; setCross(null); return; }
    // A tap on the point already marked takes the crosshair away again.
    const index = indexAt(event);
    setCross(old => event.pointerType === "touch" && old === index ? null : index);
  };
  const move = (event: React.PointerEvent) => {
    if (touches.current.has(event.pointerId)) touches.current.set(event.pointerId, event.clientX);
    if (touches.current.size === 2 && pinch.current) {
      const [a, b] = [...touches.current.values()], gap = Math.abs(a - b), rect = box.current!.getBoundingClientRect(), mid = ((a + b) / 2 - rect.left) / rect.width;
      if (pinch.current.gap > 8 && gap > 8) onZoom(gap / pinch.current.gap, Math.max(0, Math.min(1, mid)), mid - pinch.current.mid);
      pinch.current = { gap, mid }; return;
    }
    at(event);
  };
  const up = (event: React.PointerEvent) => { touches.current.delete(event.pointerId); if (touches.current.size < 2) pinch.current = null; };
  const active = cross === null ? null : bars[cross];
  const line = bars.map((b, k) => `${k ? "L" : "M"}${X(k).toFixed(1)} ${Y(b.close).toFixed(1)}`).join(" ");
  const color = lineColor ?? (rising ? UP : DOWN), gradientId = `area-${variant}`;
  const lastMa = ma.map(series => { for (let k = series.length - 1; k >= 0; k--) if (series[k] !== null) return series[k]; return null; });
  const volumeValue = active ? active.volume : defaultVolume !== undefined ? defaultVolume : bars[n - 1].volume;
  const tagColor = !tag || tag.tone === "flat" ? "#8c98ab" : tag.tone === "up" ? UP : DOWN;
  const bandX = band ? step * band.from : 0;
  // Band words ("Pre" on the first row, "After" on the second, so a narrow after-hours band never fights the pre-market band next to it): the latest bands first,
  // a word that would overlap one already placed on its row is left out (dense charts).
  const bandLabels = (() => {
    const preWord = ja ? "プレ" : "Pre", afterWord = ja ? "アフター" : "After";
    const items = [...runs.map(r => ({ x: step * r.from, w: step * (r.to - r.from + 1), pre: r.pre, text: r.pre ? preWord : afterWord })), ].reverse();
    const taken: [number, number][][] = [[], []], out: { key: string; center: number; row: number; text: string }[] = [];
    for (const item of items) {
      const half = item.text.length * (ja ? 5.5 : 3) + 3, row = item.pre ? 0 : 1, center = Math.max(half, Math.min(pw - half, item.x + item.w / 2));
      if (taken[row].some(([from, to]) => center - half < to && center + half > from)) continue;
      taken[row].push([center - half, center + half]);
      out.push({ key: `${item.x}`, center, row, text: item.text });
    }
    return out;
  })();
  const maAt = (i: number) => (board && cross !== null ? ma[i]?.[cross] : lastMa[i]) ?? null;
  const boardVolume = board && mode === "candles" && withVolume;
  return <div>
    {mode === "candles" && <div className={styles.legend}>{boardVolume && <span style={{ color: "#c4ccd9" }}><span className={styles.legendName}>{ja ? "出来高" : "Vol"}</span> {volumeValue ? compact(volumeValue) : "—"}</span>}
      {styleOf.map((m, i) => <span key={m.period} style={{ color: board ? (m.period === 25 ? "#8fb0ff" : "#c3a6ff") : m.color }}><span className={styles.legendName}>{board ? `MA ${m.period}` : ja ? m.ja : m.en}</span> {maAt(i) === null ? "—" : plain(maAt(i)!)}</span>)}</div>}
    <div ref={box} className={`${styles.frame} ${variant === "detail" ? styles.detail : board ? styles.board : styles.market}`} onPointerMove={move} onPointerDown={down} onPointerUp={up} onPointerCancel={up} onPointerLeave={event => { if (event.pointerType === "mouse") setCross(null); }} style={{ touchAction: "pan-y" }}>
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <path d={[...dateIdx.map(k => X(k)), ...(ticks ?? []).map(tick => step * tick.index)].map(x => `M${x.toFixed(1)} 8 V${withVolume ? VB : priceBottom}`).join(" ")} stroke="rgba(217,180,106,.09)" strokeWidth="1" fill="none" />
        <path d={grid.map(g => `M0 ${g.y.toFixed(1)} H${pw}`).join(" ")} stroke="rgba(217,180,106,.13)" strokeWidth="1" strokeDasharray="3 4" fill="none" />
        {withVolume && <><line x1="0" y1={SEP} x2={pw} y2={SEP} stroke="rgba(217,180,106,.22)" strokeWidth="1" />
          {bars.map((b, k) => { const up = b.close >= b.open, h = (b.volume ?? 0) / vmax * VH; return <rect key={b.at} x={X(k) - bw / 2} y={VB - h} width={bw} height={h} fill={up ? UP : DOWN} fillOpacity=".55" />; })}</>}
        {band && <rect x={bandX} y="0" width={Math.max(0, pw - bandX)} height={withVolume ? VB : priceBottom} fill="#8fe3c0" fillOpacity="0.06" data-testid="live-band" />}
        {runs.map(r => ({ x: step * r.from, w: step * (r.to - r.from + 1) })).map(band => <g key={band.x}>
          <rect x={band.x + .5} y="8" width={Math.max(0, band.w - 1)} height={(withVolume ? VB : priceBottom) - 8} rx="5" fill="rgba(127,227,192,.07)" />
          {band.w >= 8 && <line x1={band.x} y1="8" x2={band.x} y2={withVolume ? VB : priceBottom} stroke="rgba(127,227,192,.5)" strokeWidth="1" strokeDasharray="4 4" />}</g>)}
        {tag && <line x1={X(n - 1)} y1={Y(tag.price)} x2={pw} y2={Y(tag.price)} stroke={tagColor} strokeWidth="1" strokeDasharray="2 3" strokeOpacity=".8" />}
        {mode === "candles" ? <>
          {styleOf.map((m, i) => <path key={m.period} d={maPath(ma[i])} fill="none" stroke={board && m.period === 25 ? "#8fb0ff" : m.color} strokeWidth="1.4" strokeLinejoin="round" />)}
          {bars.map((b, k) => { const up = b.close >= b.open, c = up ? UP : DOWN, yt = Y(Math.max(b.open, b.close)), yb = Math.max(Y(Math.min(b.open, b.close)), yt + 1.5);
            return <g key={b.at}><path d={`M${X(k).toFixed(1)} ${Y(b.high).toFixed(1)} V${Y(b.low).toFixed(1)}`} stroke={c} strokeWidth="1.2" fill="none" /><rect x={X(k) - bw / 2} y={yt} width={bw} height={yb - yt} fill={c} /></g>; })}
        </> : <><path d={`${line} L${X(n - 1).toFixed(1)} ${priceBottom} L${X(0).toFixed(1)} ${priceBottom} Z`} fill={`url(#${gradientId})`} /><path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></>}
        {active && cross !== null && <><line x1={X(cross)} y1="8" x2={X(cross)} y2={withVolume ? VB : priceBottom} stroke={accent} strokeWidth="1.2" strokeOpacity=".9" /><line x1="0" y1={Y(active.close)} x2={pw} y2={Y(active.close)} stroke={accent} strokeWidth="1.2" strokeOpacity=".9" /><circle cx={X(cross)} cy={Y(active.close)} r="3.5" fill={accent} /></>}
      </svg>
      {grid.filter(g => !tag || Math.abs(g.y - Y(tag.price)) >= 13).map(g => <span key={g.y} className={styles.axisLabel} style={{ top: `${g.y / H * 100}%` }}>{g.label}</span>)}
      {zoomed && <button type="button" className={styles.reset} onPointerDown={event => event.stopPropagation()} onClick={onReset}>{ja ? "全体" : "Reset"}</button>}
      {bandLabels.map(label => <span key={label.key} className={styles.extLabel} style={{ left: `${label.center / W * 100}%`, top: `${(12 + label.row * 14) / H * 100}%` }}>{label.text}</span>)}
      {band && <span className={styles.liveLabel} style={{ left: `${(bandX + 4) / W * 100}%`, top: `${14 / H * 100}%` }}>{band.label}</span>}
      {tag && <span className={styles.priceTag} style={{ top: `${Y(tag.price) / H * 100}%`, background: tagColor }} data-testid="ext-tag">{tag.text ?? plain(tag.price)}</span>}
      {withVolume && !boardVolume && <span className={styles.volume} style={{ top: `${(VB - VH) / H * 100 - 1}%` }}><span className={styles.jp}>{ja ? "出来高" : "Vol"}</span> {volumeValue ? compact(volumeValue) : "—"}</span>}
      {dateIdx.filter(k => cross === null || Math.abs(X(k) - X(cross)) > 42).map(k => <span key={k} className={styles.dateLabel} style={{ left: `${X(k) / W * 100}%` }}>{label(bars[k].at)}</span>)}
      {ticks?.filter(tick => cross === null || Math.abs(step * tick.index + 16 - X(cross)) > 42).map(tick => <span key={tick.index} className={styles.sessionLabel} style={{ left: `${step * tick.index / W * 100}%` }}>{tick.label}</span>)}
      {active && cross !== null && <><span className={styles.priceTag} style={{ top: `${Y(active.close) / H * 100}%`, background: accent }}>{axis(active.close)}</span>
        <span className={styles.dateTag} style={{ left: `${X(cross) / W * 100}%`, background: accent }}>{label(active.at)}</span></>}
    </div>
  </div>;
}
