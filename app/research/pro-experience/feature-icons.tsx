import type { ReactNode } from "react";

/** The mini screens on the left of the PRO feature tour's list (owner's mockup 01-list.html, Nov 16), drawn as they are in the mockup.
 * Gold (#e2c27a) is the base; mint and red show up and down. These icons are the only gold on the list page. */
const G = "#e2c27a", MINT = "#8fe3c0", RED = "#ff7a7a";
const spokes = [[16, 18], [48, 18], [14, 46], [50, 46], [32, 12]];
const ICONS: Record<string, ReactNode> = {
  "relation-map": <>
    {spokes.map(([x, y]) => <line key={`l${x}-${y}`} x1="32" y1="32" x2={x} y2={y} stroke={G} strokeOpacity=".55" strokeWidth="1.2" />)}
    <circle cx="32" cy="32" r="6" fill={G} stroke={G} strokeWidth="1.3" />
    {spokes.map(([x, y]) => <circle key={`c${x}-${y}`} cx={x} cy={y} r="3.5" fill="#16202b" stroke={G} strokeWidth="1.3" />)}
  </>,
  "theme-ranking": <>
    {[38, 30, 22, 15].map((width, i) => <rect key={width} x="12" y={14 + i * 10} width={width} height="6" rx="3" fill={G} opacity={1 - i * 0.2} />)}
  </>,
  compare: <>
    <polygon points="32,12 50,26 44,48 20,48 14,26" fill="none" stroke="#3a4656" />
    <polygon points="32,16 46,27 40,44 22,42 18,28" fill={G} fillOpacity=".25" stroke={G} strokeWidth="1.5" />
    <polygon points="32,24 40,29 37,40 27,40 24,30" fill={MINT} fillOpacity=".25" stroke={MINT} strokeWidth="1.5" />
  </>,
  "watch-22": <>
    {([[12, 32, 14, MINT], [20.5, 24, 22, RED], [29, 36, 10, MINT], [37.5, 20, 26, MINT], [46, 28, 18, RED]] as const).map(([x, y, h, fill]) =>
      <rect key={x} x={x} y={y} width="5" height={h} rx="1.5" fill={fill} />)}
    <path d="M10 18h44" stroke={G} strokeWidth="1" strokeDasharray="2 3" opacity=".6" />
  </>,
  "rizels-desk": <>
    <rect x="12" y="16" width="40" height="7" rx="3.5" fill={G} opacity=".9" />
    <rect x="12" y="28" width="30" height="5" rx="2.5" fill="#c9b07a" opacity=".55" />
    <rect x="12" y="38" width="36" height="5" rx="2.5" fill="#c9b07a" opacity=".4" />
    <circle cx="48" cy="47" r="4" fill={G} />
  </>,
  "financial-radar": <>
    <path d="M12 50H54M12 50V12" stroke="#3a4656" />
    {([[22, 40, MINT], [30, 26, G], [40, 32, MINT], [46, 18, G], [34, 44, RED]] as const).map(([cx, cy, fill]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.2" fill={fill} />)}
  </>,
  "us-portfolio": <>
    <circle cx="32" cy="32" r="16" fill="none" stroke="#2a3542" strokeWidth="7" />
    <circle cx="32" cy="32" r="16" fill="none" stroke={G} strokeWidth="7" strokeDasharray="40 101" transform="rotate(-90 32 32)" />
    <circle cx="32" cy="32" r="16" fill="none" stroke={MINT} strokeWidth="7" strokeDasharray="28 101" strokeDashoffset="-42" transform="rotate(-90 32 32)" />
  </>,
  "phone-alerts": <>
    <path d="M22 40V31a10 10 0 0120 0v9l3 3H19z" fill="none" stroke={G} strokeWidth="2" strokeLinejoin="round" />
    <path d="M29 47h6" stroke={G} strokeWidth="2" strokeLinecap="round" />
    <circle cx="43" cy="20" r="4" fill={RED} />
  </>,
};

export const hasFeatureIcon = (id: string) => id in ICONS;
export default function FeatureIcon({ id }: { id: string }) {
  return <svg width="56" height="56" viewBox="0 0 64 64" aria-hidden="true">{ICONS[id]}</svg>;
}
