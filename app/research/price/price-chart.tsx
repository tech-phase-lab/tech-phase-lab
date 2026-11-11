"use client";
import { useEffect, useRef, useState } from "react";
import { movingAverages, plain, compact, type Bar } from "@/lib/research/market-quote";
import styles from "./chart.module.css";

const W = 390, PR = 50;
const UP = "#4fe3a6", DOWN = "#ff7b7b", GOLD = "#f3d98b";
export const MA_STYLE = [{ period: 5, color: "#f3d98b", ja: "短期", en: "Short" }, { period: 25, color: "#8fb0ff", ja: "中期", en: "Mid" }, { period: 75, color: "#c3a6ff", ja: "長期", en: "Long" }] as const;
const axis = (value: number) => Math.abs(value) >= 10000 ? `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}K` : Math.abs(value) >= 100 ? value.toFixed(0) : Math.abs(value) >= 10 ? value.toFixed(2) : value.toFixed(4);

/** The chart of the design's F and G sheets: candles (or an area line), volume bars, moving averages, thin grid, a gold crosshair with price
 * and date tags on the axes. `detail` is 390×350 with volume; `market` is 390×260 without. Everything is drawn in a 390-wide frame that scales. */
export default function PriceChart({ bars, before = [], mode, interval, variant = "detail", ja, maPeriods, accent = GOLD, lineColor, onActive }: {
  bars: Bar[]; before?: Bar[]; mode: "candles" | "line"; interval: "intraday" | "daily" | "weekly"; variant?: "detail" | "market" | "board"; ja: boolean;
  /** Moving averages to draw (default 5 / 25 / 75); the market board uses 25 / 75. */ maPeriods?: readonly number[];
  /** The crosshair and its tags (gold on the stock pages, mint on the market board). */ accent?: string; lineColor?: string;
  /** Called with the bar under the crosshair (or null), so a header can show its open / high / low / close / volume. */ onActive?: (bar: Bar | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const board = variant === "board";
  const H = variant === "detail" ? 350 : board ? 300 : 260, PT = variant === "detail" ? 30 : 24, PB = variant === "detail" ? 250 : board ? 224 : 232, VB = board ? 276 : 324, VH = board ? 44 : 52, SEP = board ? 232 : 258;
  // A series with no volume figures (forex) has no volume bars and no volume label.
  const withVolume = variant !== "market" && bars.some(b => (b.volume ?? 0) > 0);
  const priceBottom = withVolume || variant !== "board" ? PB : 268;
  const [cross, setCross] = useState<number | null>(null);
  useEffect(() => { onActive?.(cross === null ? null : bars[cross] ?? null); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cross]);
  if (bars.length < 2) return <div className={`${styles.frame} ${variant === "detail" ? styles.detail : board ? styles.board : styles.market}`} role="status"><span className={styles.empty}>{ja ? "チャートのデータがありません" : "No chart data"}</span></div>;
  const n = bars.length, lo0 = Math.min(...bars.map(b => mode === "candles" ? b.low : b.close)), hi0 = Math.max(...bars.map(b => mode === "candles" ? b.high : b.close));
  const pad = (hi0 - lo0 || hi0 * 0.02) * (variant === "detail" ? 0.08 : 0.1), lo = lo0 - pad, hi = hi0 + pad, pw = W - PR, step = pw / n, bw = Math.max(1.2, Math.min(14, step * 0.62));
  const X = (k: number) => step * (k + 0.5), Y = (v: number) => PT + (hi - v) / (hi - lo) * (priceBottom - PT);
  const rising = bars[n - 1].close >= bars[0].close;
  const grid = [0, 1, 2, 3].map(i => { const v = hi - (hi - lo) * (i + 0.5) / 4; return { y: Y(v), label: axis(v) }; });
  const dateIdx = [0.1, 0.3, 0.5, 0.7, 0.9].map(f => Math.min(n - 1, Math.round(n * f)));
  const label = (at: string) => interval === "intraday" ? (bars[0].at.slice(0, 10) === bars[n - 1].at.slice(0, 10) ? at.slice(11, 16) : `${Number(at.slice(5, 7))}/${Number(at.slice(8, 10))} ${at.slice(11, 16)}`)
    : interval === "weekly" ? `${at.slice(2, 4)}/${Number(at.slice(5, 7))}` : `${Number(at.slice(5, 7))}/${Number(at.slice(8, 10))}`;
  const vmax = Math.max(...bars.map(b => b.volume ?? 0), 1);
  const styleOf = MA_STYLE.filter(m => !maPeriods || maPeriods.includes(m.period));
  const ma = mode === "candles" ? movingAverages(before, bars, styleOf.map(m => m.period)) : [];
  const maPath = (series: (number | null)[]) => series.map((v, k) => v === null ? "" : `${k && series[k - 1] !== null ? "L" : "M"}${X(k).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const at = (event: React.PointerEvent) => { const rect = box.current!.getBoundingClientRect(); setCross(Math.max(0, Math.min(n - 1, Math.floor((event.clientX - rect.left) / rect.width * W / step)))); };
  const active = cross === null ? null : bars[cross];
  const line = bars.map((b, k) => `${k ? "L" : "M"}${X(k).toFixed(1)} ${Y(b.close).toFixed(1)}`).join(" ");
  const color = lineColor ?? (rising ? UP : DOWN), gradientId = `area-${variant}`;
  const lastMa = ma.map(series => { for (let k = series.length - 1; k >= 0; k--) if (series[k] !== null) return series[k]; return null; });
  const volumeValue = active?.volume ?? bars[n - 1].volume;
  return <div>
    {mode === "candles" && <div className={styles.legend}>{styleOf.map((m, i) => <span key={m.period} style={{ color: board ? (m.period === 25 ? "#8fb0ff" : m.color) : m.color }}><span className={styles.legendName}>{board ? `MA ${m.period}` : ja ? m.ja : m.en}</span> {lastMa[i] === null || lastMa[i] === undefined ? "—" : plain(lastMa[i]!)}</span>)}</div>}
    <div ref={box} className={`${styles.frame} ${variant === "detail" ? styles.detail : board ? styles.board : styles.market}`} onPointerMove={at} onPointerDown={at} onPointerLeave={event => { if (event.pointerType === "mouse") setCross(null); }} style={{ touchAction: "pan-y" }}>
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <path d={dateIdx.map(k => `M${X(k).toFixed(1)} 8 V${withVolume ? VB : priceBottom}`).join(" ")} stroke="rgba(217,180,106,.09)" strokeWidth="1" fill="none" />
        <path d={grid.map(g => `M0 ${g.y.toFixed(1)} H${pw}`).join(" ")} stroke="rgba(217,180,106,.13)" strokeWidth="1" strokeDasharray="3 4" fill="none" />
        {withVolume && <><line x1="0" y1={SEP} x2={pw} y2={SEP} stroke="rgba(217,180,106,.22)" strokeWidth="1" />
          {bars.map((b, k) => { const up = b.close >= b.open, h = (b.volume ?? 0) / vmax * VH; return <rect key={b.at} x={X(k) - bw / 2} y={VB - h} width={bw} height={h} fill={up ? UP : DOWN} fillOpacity=".55" />; })}</>}
        {mode === "candles" ? <>
          {styleOf.map((m, i) => <path key={m.period} d={maPath(ma[i])} fill="none" stroke={board && m.period === 25 ? "#8fb0ff" : m.color} strokeWidth="1.4" strokeLinejoin="round" />)}
          {bars.map((b, k) => { const up = b.close >= b.open, c = up ? UP : DOWN, yt = Y(Math.max(b.open, b.close)), yb = Math.max(Y(Math.min(b.open, b.close)), yt + 1.5);
            return <g key={b.at}><path d={`M${X(k).toFixed(1)} ${Y(b.high).toFixed(1)} V${Y(b.low).toFixed(1)}`} stroke={c} strokeWidth="1.2" fill="none" /><rect x={X(k) - bw / 2} y={yt} width={bw} height={yb - yt} fill={c} /></g>; })}
        </> : <><path d={`${line} L${X(n - 1).toFixed(1)} ${priceBottom} L${X(0).toFixed(1)} ${priceBottom} Z`} fill={`url(#${gradientId})`} /><path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></>}
        {active && cross !== null && <><line x1={X(cross)} y1="8" x2={X(cross)} y2={withVolume ? VB : priceBottom} stroke={accent} strokeWidth="1.2" strokeOpacity=".9" /><line x1="0" y1={Y(active.close)} x2={pw} y2={Y(active.close)} stroke={accent} strokeWidth="1.2" strokeOpacity=".9" /><circle cx={X(cross)} cy={Y(active.close)} r="3.5" fill={accent} /></>}
      </svg>
      {grid.map(g => <span key={g.y} className={styles.axisLabel} style={{ top: `${g.y / H * 100}%` }}>{g.label}</span>)}
      {withVolume && <span className={styles.volume} style={{ top: `${(VB - VH) / H * 100 - 1}%` }}><span className={styles.jp}>{ja ? "出来高" : "Vol"}</span> {volumeValue ? compact(volumeValue) : "—"}</span>}
      {dateIdx.filter(k => cross === null || Math.abs(X(k) - X(cross)) > 42).map(k => <span key={k} className={styles.dateLabel} style={{ left: `${X(k) / W * 100}%` }}>{label(bars[k].at)}</span>)}
      {active && cross !== null && <><span className={styles.priceTag} style={{ top: `${Y(active.close) / H * 100}%`, background: accent }}>{axis(active.close)}</span>
        <span className={styles.dateTag} style={{ left: `${X(cross) / W * 100}%`, background: accent }}>{label(active.at)}</span></>}
    </div>
  </div>;
}
