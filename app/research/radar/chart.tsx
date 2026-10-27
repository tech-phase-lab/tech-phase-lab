"use client";
import { useMemo } from "react";
import { X_TICKS, Y_TICKS, beyondText, isBeyond, placeLabels, xPosition, yPosition, zoneName, zoneOf, type RadarDotFree, type RadarDotPro, type Zone } from "@/lib/research/radar";
import styles from "./radar.module.css";

const W = 340, H = 316, L = 46, T = 10, R = 330, B = 282;
const RADIUS = { 1: 4.5, 2: 6.5, 3: 8.5 } as const;
const GROW = "#59d6a6", SHRINK = "#f08a8a", PLAIN = "#cfd8e3", BACKGROUND = "#0b1118";
const ZONE_FILL: Record<Zone, string> = { solid: "rgba(89,214,166,.09)", lever: "rgba(216,179,106,.09)", guard: "rgba(127,182,224,.09)", thin: "rgba(240,138,138,.10)" };
const ZONE_INK: Record<Zone, string> = { solid: "#6fdcb0", lever: "#e0c27a", guard: "#8fbfe6", thin: "#f19a9a" };
const TRAIL_MIN = 6; // a previous position closer than this on screen is not worth a line
const px = (ocf: number, r = 0) => Math.min(R - r - 1, Math.max(L + r + 1, L + xPosition(ocf) * (R - L)));
const py = (cover: number, r = 0) => Math.min(B - r - 1, Math.max(T + r + 1, B - yPosition(cover) * (B - T)));
const isPro = (dot: RadarDotFree | RadarDotPro): dot is RadarDotPro => "previous" in dot;
export const fmtCover = (n: number) => n >= 100 ? "100x超" : `${n.toFixed(2)}x`;
export const fmtPercent = (n: number) => `${Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1)}%`;
const toneColor = (tone: RadarDotFree["tone"]) => tone === "up" ? GROW : tone === "down" ? SHRINK : PLAIN;

export default function RadarChart({ dots, selected, onSelect }: { dots: (RadarDotFree | RadarDotPro)[]; selected: string | null; onSelect?: (ticker: string | null) => void }) {
  const x0 = L + xPosition(0) * (R - L), yMid = B - yPosition(1) * (B - T);
  // Each zone name sits in its outer corner, or beside the cross lines when a dot would cover the corner.
  const zoneLabels = useMemo(() => {
    const circles = dots.map(dot => ({ x: px(dot.ocfMargin, RADIUS[dot.size]), y: py(dot.cover, RADIUS[dot.size]), r: RADIUS[dot.size] + 2 }));
    const hits = (box: { x: number; y: number; w: number; h: number }) => circles.filter(c => {
      const nx = Math.min(Math.max(c.x, box.x), box.x + box.w), ny = Math.min(Math.max(c.y, box.y), box.y + box.h);
      return (nx - c.x) ** 2 + (ny - c.y) ** 2 < c.r ** 2;
    }).length;
    const specs: { zone: Zone; w: number; top: boolean; left: boolean }[] = [
      { zone: "guard", w: 60, top: true, left: true }, { zone: "solid", w: 24, top: true, left: false },
      { zone: "thin", w: 62, top: false, left: true }, { zone: "lever", w: 66, top: false, left: false },
    ];
    return specs.map(spec => {
      const h = 13, ys = spec.top ? [T + 3, yMid - h - 3] : [B - 17, yMid + 3];
      const options = ys.flatMap(y => [{ x: spec.left ? L + 4 : R - 4 - spec.w, y, w: spec.w, h }, { x: spec.left ? x0 - 4 - spec.w : x0 + 4, y, w: spec.w, h }]);
      const box = options.reduce((best, option) => hits(option) < hits(best) ? option : best);
      return { ...spec, box };
    });
  }, [dots, x0, yMid]);
  const extras = useMemo(() => Object.fromEntries(dots.map(dot => [dot.ticker, isBeyond(dot.ocfMargin, dot.cover) ? beyondText(dot.ocfMargin, dot.cover) : ""])), [dots]);
  const labels = useMemo(() => placeLabels(dots.map(dot => {
    const r = RADIUS[dot.size], extra = extras[dot.ticker];
    return { id: dot.ticker, x: px(dot.ocfMargin, r), y: py(dot.cover, r), r, w: dot.ticker.length * 6.3 + 2 + (extra ? extra.length * 4.7 + 7 : 0) };
  }), { left: L + 2, top: T + 2, right: R - 2, bottom: B - 2 }, 11, zoneLabels.map(label => label.box)), [dots, zoneLabels, extras]);
  const selectedDot = dots.find(dot => dot.ticker === selected);
  return <>
    <svg className={styles.svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="横軸が稼ぐ力、縦軸が守る力の散布図" onClick={() => onSelect?.(null)}>
      <rect x={x0} y={T} width={R - x0} height={yMid - T} fill={ZONE_FILL.solid} />
      <rect x={x0} y={yMid} width={R - x0} height={B - yMid} fill={ZONE_FILL.lever} />
      <rect x={L} y={T} width={x0 - L} height={yMid - T} fill={ZONE_FILL.guard} />
      <rect x={L} y={yMid} width={x0 - L} height={B - yMid} fill={ZONE_FILL.thin} />
      {Y_TICKS.map(tick => <g key={tick}><line x1={L} x2={R} y1={py(tick)} y2={py(tick)} className={tick === 1 ? styles.base : styles.grid} /><text x={L - 6} y={py(tick) + 3} textAnchor="end" className={styles.tick}>{`${tick}x`}</text></g>)}
      {X_TICKS.map(tick => <g key={tick}><line x1={px(tick)} x2={px(tick)} y1={T} y2={B} className={tick === 0 ? styles.base : styles.grid} /><text x={px(tick)} y={B + 14} textAnchor="middle" className={styles.tick}>{`${tick}%`}</text></g>)}
      {zoneLabels.map(label => <text key={label.zone} x={label.box.x} y={label.box.y + 10} className={styles.zone} fill={ZONE_INK[label.zone]}>{zoneName[label.zone]}</text>)}
      {dots.map(dot => {
        if (!isPro(dot) || !dot.previous) return null;
        const r = RADIUS[dot.size], x1 = px(dot.previous.ocfMargin), y1 = py(dot.previous.cover), x2 = px(dot.ocfMargin, r), y2 = py(dot.cover, r);
        if (Math.hypot(x2 - x1, y2 - y1) < TRAIL_MIN) return null;
        return <g key={`p-${dot.ticker}`}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} className={styles.trail} />
          <circle cx={x1} cy={y1} r={2.2} fill={toneColor(dot.tone)} opacity=".7" />
        </g>;
      })}
      {dots.map(dot => { const box = labels[dot.ticker]; return box?.shifted && <line key={`l-${dot.ticker}`} x1={px(dot.ocfMargin, RADIUS[dot.size])} y1={py(dot.cover, RADIUS[dot.size])} x2={box.anchor.x} y2={box.anchor.y} className={styles.leader} />; })}
      {dots.map(dot => {
        const r = RADIUS[dot.size], cx = px(dot.ocfMargin, r), cy = py(dot.cover, r), hollow = dot.up === null;
        return <g key={dot.ticker} className={onSelect ? styles.tappable : undefined} onClick={event => { event.stopPropagation(); onSelect?.(selected === dot.ticker ? null : dot.ticker); }}>
          {onSelect && <circle cx={cx} cy={cy} r={r + 9} fill="transparent" />}
          {selected === dot.ticker && <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="#e8eef5" strokeWidth="1" />}
          {hollow
            ? <circle cx={cx} cy={cy} r={r - 0.75} fill={BACKGROUND} stroke={toneColor(dot.tone)} strokeWidth="1.8" />
            : <circle cx={cx} cy={cy} r={r} fill={toneColor(dot.tone)} stroke={BACKGROUND} strokeWidth="2" />}
        </g>;
      })}
      {dots.map(dot => {
        const box = labels[dot.ticker], extra = extras[dot.ticker];
        return box && <text key={`t-${dot.ticker}`} x={box.x} y={box.y + box.h - 2} className={styles.name}>{dot.ticker}{extra && <tspan dx="5" className={styles.beyond}>{extra}</tspan>}</text>;
      })}
    </svg>
    {selectedDot && isPro(selectedDot) && <p className={styles.picked} role="status">
      <b>{selectedDot.ticker}</b><span>稼ぐ力 {fmtPercent(selectedDot.ocfMargin)}</span><span>守る力 {fmtCover(selectedDot.cover)}</span>
      <span>売上の前年比 {selectedDot.growth === null ? "—" : `${selectedDot.growth > 0 ? "+" : ""}${selectedDot.growth.toFixed(0)}%`}</span><span>決算日 {selectedDot.asOf}</span>
      <span>フリーキャッシュフロー率 {fmtPercent(selectedDot.fcfMargin)}</span>
      <i>{zoneName[zoneOf(selectedDot.ocfMargin, selectedDot.cover)]}</i>
    </p>}
  </>;
}
