"use client";

import { useId } from "react";
import styles from "./area-chart.module.css";

export default function AreaChart({ values, reference, label, className = "" }: { values: number[]; reference: number; label: string; className?: string }) {
  const gradientId = useId();
  if (values.length < 2 || !Number.isFinite(reference) || reference <= 0 || values.some(value => !Number.isFinite(value) || value <= 0)) return null;
  const changes = values.map(value => (value / reference - 1) * 100);
  const rawLow = Math.min(0, ...changes), rawHigh = Math.max(0, ...changes);
  const step = rawHigh - rawLow <= 1 ? .25 : rawHigh - rawLow <= 3 ? .5 : 1;
  const low = Math.floor(rawLow / step) * step;
  const high = Math.max(low + step, Math.ceil(rawHigh / step) * step);
  const y = (value: number) => 53 - (value - low) / (high - low) * 46;
  const coordinates = changes.map((value, i) => `${(4 + i * 192 / (changes.length - 1)).toFixed(2)},${y(value).toFixed(2)}`);
  const scale = (value: number) => `${value > 0 ? "+" : ""}${Number(value.toFixed(2))}%`;
  return <span className={`${styles.chartFrame} ${className}`}>
    <span className={styles.scale} aria-hidden="true"><span>{scale(high)}</span><span>{scale(low)}</span></span>
    <svg viewBox="0 0 200 60" preserveAspectRatio="none" role="img" aria-label={`${label} (${scale(low)} ～ ${scale(high)})`}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".32" /><stop offset="100%" stopColor="currentColor" stopOpacity=".015" /></linearGradient></defs>
      {[7, 30, 53].map(line => <line key={line} x1="0" x2="200" y1={line} y2={line} className={styles.grid} />)}
      <polygon points={`4,58 ${coordinates.join(" ")} 196,58`} fill={`url(#${gradientId})`} />
      <line x1="0" x2="200" y1={y(0)} y2={y(0)} className={styles.baseline} />
      <polyline points={coordinates.join(" ")} fill="none" stroke="currentColor" strokeOpacity=".6" strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <polyline points={coordinates.slice(-7).join(" ")} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx="196" cy={y(changes.at(-1)!)} r="5.5" fill="currentColor" opacity=".15" />
      <circle cx="196" cy={y(changes.at(-1)!)} r="2.7" fill="currentColor" />
    </svg>
  </span>;
}
