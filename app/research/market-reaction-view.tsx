import type { Language } from "@/lib/research/data";
import type { MarketReaction } from "@/lib/research/market-reaction";
import styles from "./deep-analysis-panel.module.css";

// The price chart's palette (app/research/price/price-chart.tsx): gold marks the stock, muted grey the benchmark; up / down stay in text and direction.
const GOLD = "#f3d98b", MUTED = "#8c98ab", GRID = "#22313f", INK = "#b9c7d4";
const signed = (value: number, digits = 2) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toFixed(digits)}`;
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 「翌日の市場の反応」: computed from daily prices on the server (lib/research/market-reaction.ts). Figures and fixed labels only; no reading of ours. */
export default function MarketReactionView({ reaction: r, ticker, lang }: { reaction: MarketReaction; ticker: string; lang: Language }) {
  const ja = lang === "ja";
  const stats: { label: string; value: string }[] = [
    { label: ja ? "終値（前日比）" : "Close vs prior", value: `${signed(r.closeChange)}%` },
    ...(r.gap !== null ? [{ label: ja ? "寄り付き（前日終値比）" : "Open vs prior close", value: `${signed(r.gap)}%` }] : []),
    ...(r.rangeLow !== null && r.rangeHigh !== null ? [{ label: ja ? "日中の値幅（前日終値比）" : "Intraday range vs prior close", value: `${signed(r.rangeLow, 1)}% 〜 ${signed(r.rangeHigh, 1)}%` }] : []),
    ...(r.volumeRatio !== null ? [{ label: ja ? "出来高（20日平均比）" : "Volume vs 20-day average", value: `${r.volumeRatio.toFixed(1)}${ja ? "倍" : "×"}` }] : []),
    ...(r.benchmark && r.relative !== null ? [{ label: ja ? `${r.benchmark.symbol}との差` : `vs ${r.benchmark.symbol}`, value: `${signed(r.relative)}${ja ? "pt" : " pts"}` }] : []),
  ];
  return <section className={styles.reaction} aria-label={ja ? "翌日の市場の反応" : "Next-day market reaction"}>
    <h4>{ja ? "翌日の市場の反応" : "Next-day market reaction"}</h4>
    <p className={styles.reactionWhen}>{ja ? `決算発表後、最初に引けた通常取引（米国 ${md(r.session)}）` : `First regular session to close after the release (U.S. ${md(r.session)})`}</p>
    <dl className={styles.stats}>{stats.map(s => <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>)}</dl>
    <div className={styles.charts}>
      <PriceLine reaction={r} ticker={ticker} ja={ja} />
      {r.benchmark && <CompareBars reaction={r} ticker={ticker} ja={ja} />}
    </div>
    <p className={styles.reactionNote}>{ja
      ? `日足の終値をもとに自動で計算しています。${r.benchmark ? `比較対象は${r.benchmark.ja}。` : ""}株価の動きには決算以外の要因も含まれます。価格データ：Twelve Data`
      : `Calculated automatically from daily closes.${r.benchmark ? ` Benchmark: ${r.benchmark.en}.` : ""} Price moves also reflect factors other than the release. Prices: Twelve Data`}</p>
  </section>;
}

/** Five daily closes around the release; a dashed line marks where the release fell (between the session before and the reaction session). */
function PriceLine({ reaction: r, ticker, ja }: { reaction: MarketReaction; ticker: string; ja: boolean }) {
  const W = 320, H = 150, L = 12, R = 52, T = 22, B = 26;
  const closes = r.series.map(p => p.close), lo = Math.min(...closes), hi = Math.max(...closes), pad = (hi - lo || hi * 0.02) * 0.15;
  const step = (W - L - R) / Math.max(1, r.series.length - 1);
  const X = (i: number) => L + i * step, Y = (v: number) => T + (hi + pad - v) / (hi - lo + 2 * pad) * (H - T - B);
  const path = r.series.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p.close).toFixed(1)}`).join(" ");
  const markX = (X(r.releaseIndex - 1) + X(r.releaseIndex)) / 2;
  const ticks = [hi, (hi + lo) / 2, lo];
  return <figure className={styles.chart}>
    <figcaption>{ja ? `${ticker}の終値（5営業日）` : `${ticker} daily close (5 sessions)`}</figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ja ? `${ticker}の終値の推移。決算発表の位置を破線で表示` : `${ticker} closes, release marked with a dashed line`}>
      {ticks.map((v, i) => <g key={i}><line x1={L} x2={W - R + 6} y1={Y(v)} y2={Y(v)} stroke={GRID} strokeWidth="1" />
        <text x={W - R + 10} y={Y(v) + 4} fontSize="10" fill={MUTED}>{v >= 1000 ? v.toFixed(0) : v.toFixed(2)}</text></g>)}
      <line x1={markX} x2={markX} y1={T - 8} y2={H - B} stroke={INK} strokeWidth="1" strokeDasharray="3 3" />
      <text x={markX} y={T - 11} fontSize="10" fill={INK} textAnchor="middle">{ja ? "決算発表" : "Release"}</text>
      <path d={path} fill="none" stroke={GOLD} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {r.series.map((p, i) => <g key={p.date}>
        <circle cx={X(i)} cy={Y(p.close)} r={i === r.releaseIndex ? 5 : 3.5} fill={i === r.releaseIndex ? GOLD : "#0c121a"} stroke={GOLD} strokeWidth="2">
          <title>{`${md(p.date)} ${p.close.toFixed(2)}`}</title></circle>
        <text x={X(i)} y={H - 8} fontSize="10" fill={i === r.releaseIndex ? INK : MUTED} textAnchor="middle">{md(p.date)}</text>
      </g>)}
    </svg>
  </figure>;
}

/** The reaction session's change of the stock and of its benchmark, as two bars from a zero line (direction = sign; colour = which series). */
function CompareBars({ reaction: r, ticker, ja }: { reaction: MarketReaction; ticker: string; ja: boolean }) {
  if (!r.benchmark) return null;
  const rows = [{ name: ticker, value: r.closeChange, color: GOLD }, { name: r.benchmark.symbol, value: r.benchmark.change, color: MUTED }];
  const W = 320, NAME = 52, VALUE = 62, T = 10, ROW = 34, BAR = 16, H = T + ROW * rows.length - 6;
  const span = Math.max(1, ...rows.map(row => Math.abs(row.value)));
  const negatives = rows.some(row => row.value < 0), positives = rows.some(row => row.value > 0);
  const left = NAME, right = W - VALUE, zero = negatives && positives ? (left + right) / 2 : negatives ? right : left;
  const scale = (negatives && positives ? (right - left) / 2 : right - left) / span;
  return <figure className={styles.chart}>
    <figcaption>{ja ? `${md(r.session)}の騰落率の比較` : `Change on ${md(r.session)}`}</figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ja ? `${ticker} ${signed(r.closeChange)}%、${r.benchmark.symbol} ${signed(r.benchmark.change)}%` : `${ticker} ${signed(r.closeChange)}%, ${r.benchmark.symbol} ${signed(r.benchmark.change)}%`}>
      <line x1={zero} x2={zero} y1={T - 4} y2={T + ROW * rows.length - 10} stroke={MUTED} strokeWidth="1" />
      {rows.map((row, i) => {
        const y = T + i * ROW, width = Math.max(2, Math.abs(row.value) * scale), x = row.value < 0 ? zero - width : zero;
        return <g key={row.name}>
          <text x={0} y={y + BAR - 3} fontSize="11" fill={INK}>{row.name}</text>
          <rect x={x} y={y} width={width} height={BAR} rx="4" fill={row.color}><title>{`${row.name} ${signed(row.value)}%`}</title></rect>
          <text x={W} y={y + BAR - 3} fontSize="11" fill={INK} textAnchor="end">{`${signed(row.value)}%`}</text>
        </g>;
      })}
    </svg>
  </figure>;
}
