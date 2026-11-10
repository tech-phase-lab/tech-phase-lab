"use client";
import Link from "next/link";
import StockLogo from "../watchlist/stock-logo";
import { useFacts, useNumbersHidden, useQuotes, jstClock, shortName, type CardQuote } from "./use-market";
import { compact, dateJa, money, plain, rangePosition, signedMoney, signedPercent } from "@/lib/research/market-quote";
import { useResearchLanguage } from "../use-research-language";
import styles from "./price.module.css";

export type DetailOrigin = "watchlist" | "watch" | "search";
export const detailHref = (ticker: string, from: DetailOrigin) => `/research/quote/${encodeURIComponent(ticker)}?from=${from}`;
const toneOf = (value: number | null) => value === null || value === 0 ? "flat" : value > 0 ? "up" : "down";

export function Eye({ hidden, onToggle, label }: { hidden: boolean; onToggle: () => void; label: string }) {
  return <button type="button" className={styles.eye} aria-pressed={hidden} aria-label={label} onClick={onToggle}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{hidden && <path d="M4 4l16 16" />}
    </svg>
  </button>;
}
export function Gauge({ label, low, high, price, ja }: { label: string; low: number | null; high: number | null; price: number; ja: boolean }) {
  const at = rangePosition(price, low, high);
  return <div className={styles.gauge}><h4>{label}</h4>
    <div className={styles.bar}>{at !== null && <span className={styles.mark} style={{ left: `${at}%` }} />}</div>
    <div className={styles.ends}><span>{low === null ? "—" : `${ja ? "安" : "Low"} ${plain(low)}`}</span><span>{high === null ? "—" : `${ja ? "高" : "High"} ${plain(high)}`}</span></div></div>;
}
function Dial({ position, low, high, label }: { position: number | null; low: number | null; high: number | null; label: string }) {
  // A 180° arc, drawn from the left end to the right end; the marker rides on it.
  const r = 70, cx = 90, cy = 88, angle = Math.PI * (1 - (position ?? 0) / 100);
  const point = (a: number) => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  const [mx, my] = point(angle);
  return <div className={styles.dial}>
    <svg viewBox="0 0 180 100" aria-hidden="true">
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#1c2840" strokeWidth="10" strokeLinecap="round" />
      {position !== null && position > 0 && <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${mx} ${my}`} fill="none" stroke="#c9a85a" strokeWidth="10" strokeLinecap="round" />}
      {position !== null && <circle cx={mx} cy={my} r="8" fill="#0a1119" stroke="#f3d58a" strokeWidth="4" />}
    </svg>
    <div className={styles.dialValue}>{position === null ? "—" : `${Math.round(position)}%`}</div>
    <div className={styles.dialLabel}>{label}</div>
    <div className={styles.dialEnds}><span>{low === null ? "—" : plain(low)}</span><span>{high === null ? "—" : plain(high)}</span></div>
  </div>;
}
export function Tile({ ticker }: { ticker: string }) { return <StockLogo ticker={ticker} className={styles.tile} />; }
export function Status({ quote, ja }: { quote: CardQuote; ja: boolean }) {
  const open = quote.session === "regular";
  return <><span className={styles.dot} data-open={open} aria-hidden="true" /><span>{open ? (ja ? "取引中" : "Open") : (ja ? "取引終了" : "Closed")} ・ {jstClock(quote.asOf)} JST</span></>;
}
export function Change({ quote, inline }: { quote: CardQuote; inline?: boolean }) {
  const tone = toneOf(quote.percentChange);
  const chip = <span className={styles.chip} data-tone={tone}>{tone === "up" ? "▲" : tone === "down" ? "▼" : "–"} {quote.percentChange === null ? "—" : signedPercent(quote.percentChange)}</span>;
  const amount = <span className={styles.amount} data-tone={tone}>{quote.change === null ? "" : signedMoney(quote.change, quote.currency)}</span>;
  return inline ? <div className={styles.movesInline}>{chip}{amount}</div> : <div className={styles.moves}>{chip}{amount}</div>;
}
export function Facts({ ticker, ja }: { ticker: string; ja: boolean }) {
  const facts = useFacts(ticker).data;
  return <dl className={styles.facts}>
    <div><dt>EPS</dt><dd>{facts?.eps == null ? "—" : facts.eps < 0 ? `−${plain(Math.abs(facts.eps))}` : plain(facts.eps)}</dd></div>
    <div><dt>{ja ? "時価総額" : "Mkt cap"}</dt><dd>{facts?.marketCap == null ? "—" : compact(facts.marketCap)}</dd></div>
    <div><dt>{ja ? "配当利回り" : "Div. yield"}</dt><dd>{facts?.dividendYield == null ? "—" : `${facts.dividendYield.toFixed(2)}%`}</dd></div>
    <div><dt>{ja ? "次回決算" : "Next earnings"}</dt><dd>{dateJa(facts?.nextEarnings ?? null, ja ? "ja" : "en")}</dd></div>
  </dl>;
}

/** The price card. `gauge` (today's range plus the 52-week range, with the eye button) is for the watched-22 pages;
 * `dial` (position in the 52-week range, no eye button) is for the stock search. Pressing the card opens the full detail page. */
export default function QuoteCard({ ticker, variant, from, name }: { ticker: string; variant: "gauge" | "dial"; from: DetailOrigin; name?: string }) {
  const [lang] = useResearchLanguage();
  const ja = lang === "ja";
  const { data, failed, loaded } = useQuotes([ticker]);
  const [hidden, setHidden] = useNumbersHidden();
  const quote = data?.[ticker];
  const title = shortName(name ?? quote?.name ?? ticker);
  if (!quote) return <><section className={styles.card} aria-busy={!loaded}>
    <div className={styles.top}><Tile ticker={ticker} /><div className={styles.who}><h3>{title}</h3><div className={styles.sub}><b>{ticker}</b></div></div></div>
    <p className={styles.note} role="status">{!loaded ? (ja ? "株価を読み込み中…" : "Loading the price…") : failed ? (ja ? "株価を取得できませんでした。しばらくしてからもう一度お試しください。" : "Could not load the price. Please try again shortly.") : ""}</p></section>
    <p className={styles.credit}>{ja ? "提供：Twelve Data" : "Data: Twelve Data"}</p></>;
  const hide = variant === "gauge" && hidden;
  return <><section className={styles.card} aria-label={`${title} ${ticker}`}>
    <Link className={styles.open} href={detailHref(ticker, from)} aria-label={ja ? `${title}（${ticker}）の詳細を開く` : `Open ${title} (${ticker}) details`} />
    <div className={styles.top}>
      <Tile ticker={ticker} />
      <div className={styles.who}><h3>{title}</h3><div className={styles.sub}><b>{ticker}</b>{!hide && <Status quote={quote} ja={ja} />}</div></div>
      {variant === "gauge" && <Eye hidden={hidden} onToggle={() => setHidden(!hidden)} label={hidden ? (ja ? "数字を表示する" : "Show numbers") : (ja ? "数字を隠す" : "Hide numbers")} />}
    </div>
    {hide ? <div className={styles.hiddenStars} aria-label={ja ? "数字は非表示です" : "Numbers hidden"}>＊＊＊＊＊</div> : variant === "gauge" ? <>
      <div className={styles.mid}><span className={styles.price}>{plain(quote.price)}<small>{quote.currency}</small></span><Change quote={quote} /></div>
      <div className={styles.gauges}><Gauge ja={ja} label={ja ? "本日の値幅" : "Today's range"} low={quote.low ?? null} high={quote.high ?? null} price={quote.price} /><Gauge ja={ja} label={ja ? "52週の値幅" : "52-week range"} low={quote.week52Low ?? null} high={quote.week52High ?? null} price={quote.price} /></div>
      <Facts ticker={ticker} ja={ja} />
    </> : <>
      <div className={styles.mid}><div><span className={styles.price}>{plain(quote.price)}<small>{quote.currency}</small></span><Change quote={quote} inline /></div>
        <Dial position={rangePosition(quote.price, quote.week52Low ?? null, quote.week52High ?? null)} low={quote.week52Low ?? null} high={quote.week52High ?? null} label={ja ? "52週の位置" : "52-week position"} /></div>
      <Facts ticker={ticker} ja={ja} />
    </>}
  </section><p className={styles.credit}>{ja ? "提供：Twelve Data" : "Data: Twelve Data"}</p></>;
}
export { money };
