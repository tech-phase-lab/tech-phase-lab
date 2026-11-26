"use client";
import { useMemo } from "react";
import { placeLabels, proRankPlaces, zoneLabel, type RadarDotFree, type RadarDotPro, type RadarRankDot, type Zone } from "@/lib/research/radar";
import styles from "./radar.module.css";

const RADIUS = { 1: 3.5, 2: 5.5, 3: 7.5 } as const;
const GROW = "#59d6a6", SHRINK = "#f08a8a", PLAIN = "#cfd8e3", BACKGROUND = "#0b1118", GOLD = "#d9b56a";
const ZONE_FILL: Record<Zone, string> = { solid: "rgba(89,214,166,.09)", lever: "rgba(216,179,106,.09)", guard: "rgba(127,182,224,.09)", thin: "rgba(240,138,138,.10)" };
const ZONE_INK: Record<Zone, string> = { solid: "#6fdcb0", lever: "#e0c27a", guard: "#8fbfe6", thin: "#f19a9a" };
const TRAIL_MIN = 6; // a previous position closer than this on screen is not worth a line
export const fmtCover = (n: number, lang: "ja" | "en" = "ja") => n >= 100 ? (lang === "ja" ? "100x超" : "100x+") : `${n.toFixed(2)}x`;
export const fmtPercent = (n: number) => `${Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1)}%`;
const toneColor = (tone: RadarDotFree["tone"]) => tone === "up" ? GROW : tone === "down" ? SHRINK : PLAIN;

// ---- the frame both charts share (owner, Nov 26: PRO is placed by rank too, as FREE since Nov 25) ----
const FW = 340, FH = 300, FL = 4, FT = 4, FR = 336, FB = 296, PAD_X = 24, PAD_Y = 30;
const rx = (x: number) => FL + PAD_X + x * (FR - FL - 2 * PAD_X);
const ry = (y: number) => FB - PAD_Y - y * (FB - FT - 2 * PAD_Y);
/** The four zone names, each in its own outer corner of the frame. */
const cornerZones = (ja: boolean) => ([
  { zone: "guard", top: true, left: true }, { zone: "solid", top: true, left: false },
  { zone: "thin", top: false, left: true }, { zone: "lever", top: false, left: false },
] as { zone: Zone; top: boolean; left: boolean }[]).map(spec => {
  const w = ja ? zoneLabel(spec.zone, "ja").length * 10 + 2 : Math.round(zoneLabel(spec.zone, "en").length * 6.2 + 4), h = 13;
  return { ...spec, box: { x: spec.left ? FL + 6 : FR - 6 - w, y: spec.top ? FT + 5 : FB - 5 - h, w, h } };
});
const rankText = (rank: number, count: number, ja: boolean) => ja ? `${count}社中${rank}位` : `#${rank} of ${count}`;
const moveText = (move: number, ja: boolean) => move === 0 ? (ja ? "変わらず" : "unchanged") : ja ? `${Math.abs(move)}つ${move > 0 ? "上" : "下"}` : `${move > 0 ? "up" : "down"} ${Math.abs(move)}`;

/** PRO chart (owner, Nov 26): dots by rank inside the genre exactly as the FREE chart, no ticks and nothing stopped at an edge. A dot can be
 * tapped (gold ring) to show its figures, its two ranks and how they moved since the previous earnings; the dotted line is that move. */
export default function RadarChart({ dots, selected, onSelect, lang = "ja" }: { dots: RadarDotPro[]; selected: string | null; onSelect?: (ticker: string | null) => void; lang?: "ja" | "en" }) {
  const ja = lang === "ja";
  const xm = (FL + FR) / 2, ym = (FT + FB) / 2;
  const layout = useMemo(() => proRankPlaces(dots), [dots]);
  const at = (ticker: string) => ({ x: rx(layout.places[ticker].x), y: ry(layout.places[ticker].y) });
  const zones = useMemo(() => cornerZones(ja), [ja]);
  const labels = useMemo(() => placeLabels(dots.map(dot => ({ id: dot.ticker, x: rx(layout.places[dot.ticker].x), y: ry(layout.places[dot.ticker].y), r: RADIUS[dot.size], w: dot.ticker.length * 6.3 + 2 })),
    { left: FL + 2, top: FT + 2, right: FR - 2, bottom: FB - 2 }, 11, zones.map(zone => zone.box), selected), [dots, layout, zones, selected]);
  return <svg className={styles.svg} viewBox={`0 0 ${FW} ${FH}`} role="img" aria-label={ja ? "ジャンルの中の順位で並べた散布図。横が稼ぐ力、縦が守る力" : "Scatter plot by rank within the genre: earning power across, financial cushion up"} onClick={() => onSelect?.(null)}>
      <defs><clipPath id="pro-rank-frame"><rect x={FL} y={FT} width={FR - FL} height={FB - FT} rx="10" /></clipPath></defs>
      <g clipPath="url(#pro-rank-frame)">
        <rect x={xm} y={FT} width={FR - xm} height={ym - FT} fill={ZONE_FILL.solid} />
        <rect x={xm} y={ym} width={FR - xm} height={FB - ym} fill={ZONE_FILL.lever} />
        <rect x={FL} y={FT} width={xm - FL} height={ym - FT} fill={ZONE_FILL.guard} />
        <rect x={FL} y={ym} width={xm - FL} height={FB - ym} fill={ZONE_FILL.thin} />
      </g>
      <line x1={xm} x2={xm} y1={FT} y2={FB} className={styles.base} />
      <line x1={FL} x2={FR} y1={ym} y2={ym} className={styles.base} />
      {zones.map(zone => <text key={zone.zone} x={zone.box.x} y={zone.box.y + 10} className={styles.zone} fill={ZONE_INK[zone.zone]}>{zoneLabel(zone.zone, lang)}</text>)}
      {/* Since the previous earnings: the previous place is its rank among the genre's previous earnings only. The small dot keeps the dot's colour:
          the previous earnings' revenue growth is not stored (radar-store.ts), so it cannot be coloured by that report's own growth. */}
      {dots.map(dot => {
        const before = layout.places[dot.ticker].previous;
        if (!dot.previous || !before) return null;
        const x1 = rx(before.x), y1 = ry(before.y), { x: x2, y: y2 } = at(dot.ticker);
        if (Math.hypot(x2 - x1, y2 - y1) < TRAIL_MIN) return null;
        return <g key={`p-${dot.ticker}`}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} className={styles.trail} />
          <circle cx={x1} cy={y1} r={2.2} fill={toneColor(dot.tone)} opacity=".7" />
        </g>;
      })}
      {dots.map(dot => { const box = labels[dot.ticker]; return box?.shifted && <line key={`l-${dot.ticker}`} x1={at(dot.ticker).x} y1={at(dot.ticker).y} x2={box.anchor.x} y2={box.anchor.y} className={styles.leader} />; })}
      {dots.map(dot => {
        const r = RADIUS[dot.size], { x: cx, y: cy } = at(dot.ticker), hollow = dot.up === null;
        return <g key={dot.ticker} data-ticker={dot.ticker} className={onSelect ? styles.tappable : undefined} onClick={event => { event.stopPropagation(); onSelect?.(selected === dot.ticker ? null : dot.ticker); }}>
          {onSelect && <circle cx={cx} cy={cy} r={r + 9} fill="transparent" />}
          {selected === dot.ticker && <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke={GOLD} strokeWidth="2" />}
          {hollow
            ? <circle cx={cx} cy={cy} r={r - 0.75} fill={BACKGROUND} stroke={toneColor(dot.tone)} strokeWidth="1.8" />
            : <circle cx={cx} cy={cy} r={r} fill={toneColor(dot.tone)} stroke={BACKGROUND} strokeWidth="2" />}
        </g>;
      })}
      {dots.map(dot => { const box = labels[dot.ticker]; return box && <text key={`t-${dot.ticker}`} x={box.x} y={box.y + box.h - 2} className={styles.name}>{dot.ticker}</text>; })}
    </svg>;
}

/** What a tap on a PRO dot shows, in a gold frame (owner, Nov 26): the figures with their ranks in the genre, and the move since the previous earnings. */
export function PickedDot({ dots, selected, lang = "ja" }: { dots: RadarDotPro[]; selected: string | null; lang?: "ja" | "en" }) {
  const ja = lang === "ja";
  const layout = useMemo(() => proRankPlaces(dots), [dots]);
  const selectedDot = dots.find(dot => dot.ticker === selected);
  const place = selectedDot ? layout.places[selectedDot.ticker] : null;
  return selectedDot && place ? <div className={styles.picked} role="status">
      <p className={styles.pickedHead}><b>{selectedDot.ticker}</b><i>{zoneLabel(place.zone, lang)}</i></p>
      <dl>
        <div><dt>{ja ? "稼ぐ力" : "Cash generation"}</dt><dd>{selectedDot.noRevenue ? (ja ? "売上なし" : "No revenue") : <><em>{fmtPercent(selectedDot.ocfMargin)}</em><span>{rankText(place.earnRank, layout.count, ja)}</span></>}</dd></div>
        <div><dt>{ja ? "守る力" : "Resilience"}</dt><dd><em>{fmtCover(selectedDot.cover, lang)}</em><span>{rankText(place.coverRank, layout.count, ja)}</span></dd></div>
        {place.previous && <div><dt>{ja ? "前の決算から" : "Since the previous report"}</dt><dd>{ja ? `稼ぐ力 ${moveText(place.previous.earnMove, ja)}・守る力 ${moveText(place.previous.coverMove, ja)}` : `Cash generation ${moveText(place.previous.earnMove, ja)} · Resilience ${moveText(place.previous.coverMove, ja)}`}</dd></div>}
        <div><dt>{ja ? "売上の前年比" : "Revenue YoY"}</dt><dd><em>{selectedDot.growth === null ? "—" : `${selectedDot.growth > 0 ? "+" : ""}${selectedDot.growth.toFixed(0)}%`}</em></dd></div>
        <div><dt>{ja ? "決算日" : "Earnings date"}</dt><dd><em>{selectedDot.asOf}</em></dd></div>
        {!selectedDot.noRevenue && <div><dt>{ja ? "フリーキャッシュフロー率" : "Free cash flow margin"}</dt><dd><em>{fmtPercent(selectedDot.fcfMargin)}</em></dd></div>}
      </dl>
      {selectedDot.prepaid && <small>{ja ? "前受け金を除いた値" : "Excluding customer prepayments"}</small>}
      {selectedDot.review && <small>{ja ? "前受け金を含む値" : "Includes customer prepayments"}</small>}
    </div> : null;
}

// ---- FREE chart (owner, Nov 25): dots placed by rank inside the genre, no figures, nothing to tap ----

export function RankChart({ dots, lang = "ja" }: { dots: RadarRankDot[]; lang?: "ja" | "en" }) {
  const ja = lang === "ja";
  const xm = (FL + FR) / 2, ym = (FT + FB) / 2;
  const zones = useMemo(() => cornerZones(ja), [ja]);
  const labels = useMemo(() => placeLabels(dots.map(dot => ({ id: dot.ticker, x: rx(dot.x), y: ry(dot.y), r: RADIUS[dot.size], w: dot.ticker.length * 6.3 + 2 })),
    { left: FL + 2, top: FT + 2, right: FR - 2, bottom: FB - 2 }, 11, zones.map(zone => zone.box)), [dots, zones]);
  return <svg className={styles.svg} viewBox={`0 0 ${FW} ${FH}`} role="img" aria-label={ja ? "ジャンルの中の順位で並べた散布図。横が稼ぐ力、縦が守る力" : "Scatter plot by rank within the genre: earning power across, financial cushion up"}>
    <defs><clipPath id="rank-frame"><rect x={FL} y={FT} width={FR - FL} height={FB - FT} rx="10" /></clipPath></defs>
    <g clipPath="url(#rank-frame)">
      <rect x={xm} y={FT} width={FR - xm} height={ym - FT} fill={ZONE_FILL.solid} />
      <rect x={xm} y={ym} width={FR - xm} height={FB - ym} fill={ZONE_FILL.lever} />
      <rect x={FL} y={FT} width={xm - FL} height={ym - FT} fill={ZONE_FILL.guard} />
      <rect x={FL} y={ym} width={xm - FL} height={FB - ym} fill={ZONE_FILL.thin} />
    </g>
    <line x1={xm} x2={xm} y1={FT} y2={FB} className={styles.base} />
    <line x1={FL} x2={FR} y1={ym} y2={ym} className={styles.base} />
    {zones.map(zone => <text key={zone.zone} x={zone.box.x} y={zone.box.y + 10} className={styles.zone} fill={ZONE_INK[zone.zone]}>{zoneLabel(zone.zone, lang)}</text>)}
    {dots.map(dot => { const box = labels[dot.ticker]; return box?.shifted && <line key={`l-${dot.ticker}`} x1={rx(dot.x)} y1={ry(dot.y)} x2={box.anchor.x} y2={box.anchor.y} className={styles.leader} />; })}
    {dots.map(dot => {
      const r = RADIUS[dot.size], cx = rx(dot.x), cy = ry(dot.y);
      return dot.up === null
        ? <circle key={dot.ticker} cx={cx} cy={cy} r={r - 0.75} fill={BACKGROUND} stroke={toneColor(dot.tone)} strokeWidth="1.8" />
        : <circle key={dot.ticker} cx={cx} cy={cy} r={r} fill={toneColor(dot.tone)} stroke={BACKGROUND} strokeWidth="2" />;
    })}
    {dots.map(dot => { const box = labels[dot.ticker]; return box && <text key={`t-${dot.ticker}`} x={box.x} y={box.y + box.h - 2} className={styles.name}>{dot.ticker}</text>; })}
  </svg>;
}
