"use client";

import { useId } from "react";
import styles from "./area-chart.module.css";

const W = 84, H = 52, LEFT = 1, RIGHT = 77, TOP = 13, BOTTOM = 40;
const MINT = "#5fe0aa", RED = "#ff7a7a";

/** A smooth line through the points (Catmull-Rom as cubic Béziers). */
function smooth(points: [number, number][]) {
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** The watchlist row's chart (owner, Nov 13): 84×52, a dotted line at the previous close, the line mint above it and red below, the space
 * between the line and the dotted line tinted the same colour (0.16), the line fading in from the left (0.12 → 1), a dot on the latest value
 * with a faint halo and a ring that spreads every two seconds, and the day's high and low (of the drawn data) at the top and bottom left. */
export default function AreaChart({ values, reference, label, className = "" }: { values: number[]; reference: number; label: string; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (values.length < 2 || !Number.isFinite(reference) || reference <= 0 || values.some(value => !Number.isFinite(value) || value <= 0)) return null;
  const high = Math.max(...values), low = Math.min(...values);
  const top = Math.max(high, reference), bottom = Math.min(low, reference), span = top - bottom || 1;
  const y = (value: number) => BOTTOM - (value - bottom) / span * (BOTTOM - TOP);
  const x = (index: number) => LEFT + index * (RIGHT - LEFT) / (values.length - 1);
  const points = values.map((value, index) => [x(index), y(value)] as [number, number]);
  const line = smooth(points), base = y(reference).toFixed(1);
  const area = `${line}L${RIGHT} ${base}L${LEFT} ${base}Z`;
  const last = points[points.length - 1], color = values[values.length - 1] >= reference ? MINT : RED;
  const price = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <svg className={`${styles.chart} ${className}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} (${price(low)} – ${price(high)})`}>
    <defs>
      <clipPath id={`${id}a`}><rect x="-4" y="-4" width={W + 8} height={Number(base) + 4} /></clipPath>
      <clipPath id={`${id}u`}><rect x="-4" y={base} width={W + 8} height={H} /></clipPath>
      <linearGradient id={`${id}g`} x1="0" y1="0" x2={W} y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#fff" stopOpacity="0.12" /><stop offset="0.7" stopColor="#fff" stopOpacity="0.75" /><stop offset="1" stopColor="#fff" stopOpacity="1" /></linearGradient>
      <mask id={`${id}m`}><rect x="-4" y="-4" width={W + 8} height={H + 8} fill={`url(#${id}g)`} /></mask>
    </defs>
    <line x1="0" x2={W} y1={base} y2={base} stroke="#4f5b6a" strokeWidth="1" strokeDasharray="1.5 3" />
    <g mask={`url(#${id}m)`}>
      <path d={area} fill={MINT} fillOpacity="0.16" clipPath={`url(#${id}a)`} />
      <path d={area} fill={RED} fillOpacity="0.16" clipPath={`url(#${id}u)`} />
      <path d={line} fill="none" stroke={MINT} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${id}a)`} />
      <path d={line} fill="none" stroke={RED} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${id}u)`} />
    </g>
    <circle cx={last[0]} cy={last[1]} r="7" fill={color} fillOpacity="0.18" />
    <circle className={styles.ring} cx={last[0]} cy={last[1]} r="2.6" fill={color} />
    <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} stroke="#0a0e14" strokeWidth="1.2" />
    <text className={styles.level} x="0" y="8">{price(high)}</text>
    <text className={styles.level} x="0" y="51">{price(low)}</text>
  </svg>;
}
