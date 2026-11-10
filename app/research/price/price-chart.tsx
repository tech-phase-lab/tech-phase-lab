"use client";
import { useEffect, useRef, useState } from "react";
import type { Bar } from "@/lib/research/market-quote";
import { plain } from "@/lib/research/market-quote";
import styles from "./detail.module.css";

const H = 360, PAD = { top: 56, bottom: 22, right: 56, left: 4 };
const label = (at: string, intraday: boolean) => intraday ? `${at.slice(5, 10).replace("-", "/")} ${at.slice(11, 16)}` : at.slice(5, 10).replace("-", "/").replace(/^0/, "");
/** Candlesticks (green up, red down) or a line, with a gold crosshair that reads the bar under a finger or the pointer. */
export default function PriceChart({ bars, mode, intraday, ja }: { bars: Bar[]; mode: "candles" | "line"; intraday: boolean; ja: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [pointer, setPointer] = useState<number | null>(null);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (bars.length < 2) return <div ref={box} className={styles.chartEmpty} role="status">{ja ? "チャートのデータがありません" : "No chart data"}</div>;
  const low = Math.min(...bars.map(b => mode === "candles" ? b.low : b.close)), high = Math.max(...bars.map(b => mode === "candles" ? b.high : b.close));
  const pad = (high - low || high * 0.02) * 0.08, top = high + pad, bottom = low - pad;
  const plotW = width - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom, step = plotW / bars.length;
  const x = (i: number) => PAD.left + step * (i + 0.5), y = (v: number) => PAD.top + (top - v) / (top - bottom) * plotH;
  const ticks = [0, 1, 2, 3].map(i => bottom + (top - bottom) * (i + 0.5) / 4);
  const index = pointer === null ? null : Math.max(0, Math.min(bars.length - 1, Math.floor((pointer - PAD.left) / step)));
  const active = index === null ? null : bars[index];
  const move = (event: React.PointerEvent<SVGSVGElement>) => { const rect = event.currentTarget.getBoundingClientRect(); setPointer(event.clientX - rect.left); };
  return <div ref={box} className={styles.chart}>
    <svg width={width} height={H} role="img" aria-label={ja ? "株価チャート" : "Price chart"} onPointerMove={move} onPointerDown={move} onPointerLeave={() => setPointer(null)} onPointerCancel={() => setPointer(null)} style={{ touchAction: "pan-y" }}>
      {ticks.map(t => <g key={t}><line x1={0} x2={width - PAD.right + 8} y1={y(t)} y2={y(t)} stroke="#243044" strokeDasharray="3 5" /><text x={width - PAD.right + 12} y={y(t) + 4} fill="#8f9bb0" fontSize="12" fontFamily="IBM Plex Mono, monospace">{Math.abs(t) >= 100 ? Math.round(t) : t.toFixed(2)}</text></g>)}
      {mode === "candles" ? bars.map((b, i) => {
        const up = b.close >= b.open, color = up ? "#4fe3a6" : "#ff7b7b", w = Math.max(1.5, Math.min(12, step * 0.66));
        return <g key={b.at} stroke={color} fill={color}><line x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)} strokeWidth="1.5" /><rect x={x(i) - w / 2} y={Math.min(y(b.open), y(b.close))} width={w} height={Math.max(1.5, Math.abs(y(b.open) - y(b.close)))} /></g>;
      }) : <><polygon points={`${x(0)},${H - PAD.bottom} ${bars.map((b, i) => `${x(i)},${y(b.close)}`).join(" ")} ${x(bars.length - 1)},${H - PAD.bottom}`} fill="#d9bd7c" opacity=".12" />
        <polyline points={bars.map((b, i) => `${x(i)},${y(b.close)}`).join(" ")} fill="none" stroke="#e3c981" strokeWidth="2.4" strokeLinejoin="round" /></>}
      {active && index !== null && <g>
        <line x1={x(index)} x2={x(index)} y1={PAD.top - 6} y2={H - PAD.bottom} stroke="#e3c981" strokeDasharray="4 4" />
        <g transform={`translate(${Math.max(46, Math.min(width - PAD.right - 46, x(index)))},6)`}><rect x={-46} width={92} height={42} rx={8} fill="#171409" stroke="#d9bd7c" /><text y={17} textAnchor="middle" fill="#9aa6bb" fontSize="12" fontFamily="IBM Plex Mono, monospace">{label(active.at, intraday)}</text><text y={36} textAnchor="middle" fill="#f3d58a" fontSize="17" fontWeight="700" fontFamily="IBM Plex Mono, monospace">{plain(active.close)}</text></g>
      </g>}
    </svg>
  </div>;
}
