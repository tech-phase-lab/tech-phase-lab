"use client";
import { useMemo } from "react";
import { X_TICKS, Y_TICKS, placeLabels, xPosition, yPosition, zoneName, zoneOf, type RadarDotFree, type RadarDotPro, type Zone } from "@/lib/research/radar";
import styles from "./radar.module.css";

const W = 340, H = 316, L = 46, T = 10, R = 330, B = 282;
const RADIUS = { 1: 4.5, 2: 6.5, 3: 8.5 } as const;
const GROW = "#59d6a6", SHRINK = "#f08a8a", UNKNOWN = "#8a95a3";
const ZONE_FILL: Record<Zone, string> = { solid: "rgba(89,214,166,.09)", lever: "rgba(216,179,106,.09)", guard: "rgba(127,182,224,.09)", thin: "rgba(240,138,138,.10)" };
const ZONE_INK: Record<Zone, string> = { solid: "#6fdcb0", lever: "#e0c27a", guard: "#8fbfe6", thin: "#f19a9a" };
const px = (fcf: number, r = 0) => Math.min(R - r - 1, Math.max(L + r + 1, L + xPosition(fcf) * (R - L)));
const py = (cover: number, r = 0) => Math.min(B - r - 1, Math.max(T + r + 1, B - yPosition(cover) * (B - T)));
const isPro = (dot: RadarDotFree | RadarDotPro): dot is RadarDotPro => "previous" in dot;
const fmtCover = (n: number) => n >= 100 ? "100x超" : `${n.toFixed(2)}x`;
const fmtPercent = (n: number) => `${Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1)}%`;

export default function RadarChart({ dots, selected, onSelect }: { dots: (RadarDotFree | RadarDotPro)[]; selected: string | null; onSelect?: (ticker: string | null) => void }) {
  const x0 = L + xPosition(0) * (R - L), yMid = B - yPosition(1) * (B - T);
  // Each zone name sits in its outer corner, or beside the cross lines when a dot would cover the corner.
  const zoneLabels = useMemo(() => {
    const circles = dots.map(dot => ({ x: px(dot.fcfMargin, RADIUS[dot.size]), y: py(dot.cover, RADIUS[dot.size]), r: RADIUS[dot.size] + 2 }));
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
  const labels = useMemo(() => placeLabels(dots.map(dot => {
    const r = RADIUS[dot.size];
    return { id: dot.ticker, x: px(dot.fcfMargin, r), y: py(dot.cover, r), r, w: dot.ticker.length * 6.3 + 2 };
  }), { left: L + 2, top: T + 2, right: R - 2, bottom: B - 2 }, 11, zoneLabels.map(label => label.box)), [dots, zoneLabels]);
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
      {dots.map(dot => isPro(dot) && dot.previous && <g key={`p-${dot.ticker}`}>
        <line x1={px(dot.previous.fcfMargin)} y1={py(dot.previous.cover)} x2={px(dot.fcfMargin, RADIUS[dot.size])} y2={py(dot.cover, RADIUS[dot.size])} className={styles.trail} />
        <circle cx={px(dot.previous.fcfMargin)} cy={py(dot.previous.cover)} r={2.2} fill={dot.up === false ? SHRINK : dot.up ? GROW : UNKNOWN} opacity=".7" />
      </g>)}
      {dots.map(dot => {
        const r = RADIUS[dot.size], cx = px(dot.fcfMargin, r), cy = py(dot.cover, r);
        const fill = dot.up === null ? UNKNOWN : dot.up ? GROW : SHRINK;
        return <g key={dot.ticker} className={onSelect ? styles.tappable : undefined} onClick={event => { event.stopPropagation(); onSelect?.(selected === dot.ticker ? null : dot.ticker); }}>
          {onSelect && <circle cx={cx} cy={cy} r={r + 9} fill="transparent" />}
          {selected === dot.ticker && <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="#e8eef5" strokeWidth="1" />}
          <circle cx={cx} cy={cy} r={r} fill={fill} stroke="#0b1118" strokeWidth="2" />
        </g>;
      })}
      {dots.map(dot => { const box = labels[dot.ticker]; return box && <text key={`t-${dot.ticker}`} x={box.x} y={box.y + box.h - 2} className={styles.name}>{dot.ticker}</text>; })}
    </svg>
    {selectedDot && isPro(selectedDot) && <p className={styles.picked} role="status">
      <b>{selectedDot.ticker}</b><span>稼ぐ力 {fmtPercent(selectedDot.fcfMargin)}</span><span>守る力 {fmtCover(selectedDot.cover)}</span>
      <span>売上の前年比 {selectedDot.growth === null ? "—" : `${selectedDot.growth > 0 ? "+" : ""}${selectedDot.growth.toFixed(0)}%`}</span><span>決算日 {selectedDot.asOf}</span>
      <i>{zoneName[zoneOf(selectedDot.fcfMargin, selectedDot.cover)]}</i>
    </p>}
  </>;
}
export { fmtCover, fmtPercent };
