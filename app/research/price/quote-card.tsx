"use client";
import { useState } from "react";
import Link from "next/link";
import StockLogo from "../watchlist/stock-logo";
import { useFacts, useNumbersHidden, useQuotes, shortName, type CardQuote } from "./use-market";
import { compact, dateJa, plain, rangePosition, signedBoth, signedMoney, signedPercent } from "@/lib/research/market-quote";
import { useResearchLanguage } from "../use-research-language";
import StarButton from "./star-button";
import styles from "./price.module.css";

export type DetailOrigin = "watchlist" | "watch" | "search" | "market";
export const detailHref = (ticker: string, from: DetailOrigin) => `/research/quote/${encodeURIComponent(ticker)}?from=${from}`;
export const toneOf = (value: number | null) => value === null || value === 0 ? "flat" : value > 0 ? "up" : "down";
const clock = (iso: string, seconds: boolean) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false });

export function Eye({ hidden, onToggle, label }: { hidden: boolean; onToggle: () => void; label: string }) {
  return <button type="button" className={styles.eye} aria-pressed={hidden} aria-label={label} onClick={onToggle}>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{hidden && <path d="M3 3l18 18" />}
    </svg>
  </button>;
}
export function Tile({ ticker, size = "gauge" }: { ticker: string; size?: "gauge" | "dial" | "detail" }) {
  return <StockLogo ticker={ticker} className={`${styles.tile} ${size === "dial" ? styles.tileDial : size === "detail" ? styles.tileDetail : ""}`} />;
}
/** "取引終了 ・ 06:00 JST" (a green point while the regular session is open). */
export function Status({ quote, ja, update }: { quote: CardQuote; ja: boolean; update?: boolean }) {
  const open = quote.session === "regular";
  return <><span className={styles.dot} data-open={open} aria-hidden="true" /><span>{open ? (ja ? "取引中" : "Open") : (ja ? "取引終了" : "Closed")} ・ {clock(quote.asOf, false)} JST{update ? (ja ? " 更新" : " updated") : ""}</span></>;
}
/** The pre-market / after-hours line: the label, a pulsing point and the time of the latest extended quote, then its price and its move from the close. */
export function Extended({ quote, ja }: { quote: CardQuote; ja: boolean }) {
  const ext = quote.extended;
  if (!ext) return null;
  const amount = ext.price - quote.price, tone = toneOf(ext.percentChange);
  return <div className={styles.ext}>
    <span className={styles.extLeft}><span className={styles.extLabel}>{ext.session === "pre" ? (ja ? "プレ" : "Pre") : (ja ? "時間外" : "After")}</span><span className={styles.extTime}><span className={styles.live} aria-hidden="true" />{clock(ext.asOf, true)}</span></span>
    <span className={styles.extRight}><b>{plain(ext.price)}</b><span className={styles[tone]}>{signedBoth(amount, ext.percentChange)}</span></span>
  </div>;
}
export function Gauge({ label, low, high, price, ja }: { label: string; low: number | null; high: number | null; price: number; ja: boolean }) {
  const at = rangePosition(price, low, high);
  void ja;
  return <div className={styles.gauge}><span className={styles.gaugeHead}><span>{label}</span><span>{low === null || high === null ? "—" : `${plain(low)}–${plain(high)}`}</span></span>
    <div className={styles.bar}>{at !== null && <span className={styles.mark} style={{ left: `${at}%` }} />}</div></div>;
}
function Dial({ position, low, high, label }: { position: number | null; low: number | null; high: number | null; label: string }) {
  const t = (position ?? 0) / 100, a = Math.PI * (1 - t), ax = 60 + 50 * Math.cos(a), ay = 60 - 50 * Math.sin(a);
  return <div className={styles.dial}>
    <div className={styles.dialBox}>
      <svg viewBox="0 0 120 66" role="img" aria-label={`${label} ${position === null ? "—" : Math.round(position)}%`}>
        <defs><linearGradient id="gArcDial" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#c9a14e" /><stop offset="1" stopColor="#f3d98b" /></linearGradient></defs>
        <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="#1b2536" strokeWidth="7" strokeLinecap="round" />
        {position !== null && position > 0 && <path d={`M10 60 A50 50 0 0 1 ${ax.toFixed(1)} ${ay.toFixed(1)}`} fill="none" stroke="url(#gArcDial)" strokeWidth="7" strokeLinecap="round" />}
        {position !== null && <><circle cx={ax} cy={ay} r="9" fill="#f3d98b" fillOpacity=".2" /><circle cx={ax} cy={ay} r="5" fill="#f3d98b" stroke="#0b0f16" strokeWidth="2" /></>}
      </svg>
      <div className={styles.dialText}><b>{position === null ? "—" : `${Math.round(position)}%`}</b><span>{label}</span></div>
    </div>
    <div className={styles.dialEnds}><span>{low === null ? "—" : plain(low)}</span><span>{high === null ? "—" : plain(high)}</span></div>
  </div>;
}
const eps = (value: number | null | undefined) => value == null ? "—" : value < 0 ? `−${plain(Math.abs(value))}` : plain(value);

/** The price card. `gauge` (today's range + 52-week range, eye button) is for the watched-22 pages; `dial` (position in the 52-week range, no eye
 * button) is for the stock search. Pressing the card opens the full detail page. Sizes follow the design's E sheet. */
export default function QuoteCard({ ticker, variant, from, name, star = false }: { ticker: string; variant: "gauge" | "dial"; from: DetailOrigin; name?: string; star?: boolean }) {
  const [lang] = useResearchLanguage();
  const ja = lang === "ja";
  const { data, failed, loaded } = useQuotes([ticker]);
  const facts = useFacts(ticker).data;
  const [hidden, setHidden] = useNumbersHidden();
  const quote = data?.[ticker];
  // Watched-22 cards carry their own short English names; search results arrive with the SEC's upper-case registrant name, so the provider's name comes first there.
  const title = shortName(variant === "dial" ? (quote?.name ?? name ?? ticker) : (name ?? quote?.name ?? ticker));
  const frame = variant === "gauge" ? styles.gaugeCard : styles.dialCard;
  if (!quote) return <><section className={`${styles.card} ${frame}`} aria-busy={!loaded}>
    <div className={styles.head}><Tile ticker={ticker} size={variant === "dial" ? "dial" : "gauge"} /><div className={styles.who}><h3 className={styles.name}>{title}</h3></div></div>
    <p className={styles.note} role="status">{!loaded ? (ja ? "株価を読み込み中…" : "Loading the price…") : failed ? (ja ? "株価を取得できませんでした。しばらくしてからもう一度お試しください。" : "Could not load the price. Please try again shortly.") : ""}</p></section>
    <p className={styles.credit}>{ja ? "提供：Twelve Data" : "Data: Twelve Data"}</p></>;
  const hide = variant === "gauge" && hidden;
  const tone = toneOf(quote.percentChange);
  const arrow = tone === "up" ? "▲" : tone === "down" ? "▼" : "–";
  const open = <Link className={styles.open} href={detailHref(ticker, from)} aria-label={ja ? `${title}（${ticker}）の詳細を開く` : `Open ${title} (${ticker}) details`} />;
  const eye = star ? <StarButton ticker={ticker} name={title} /> : variant === "gauge" && <Eye hidden={hidden} onToggle={() => setHidden(!hidden)} label={hidden ? (ja ? "数字を表示する" : "Show numbers") : (ja ? "数字を隠す" : "Hide numbers")} />;
  if (hide) return <><section className={`${styles.card} ${styles.hiddenCard}`} aria-label={`${title} ${ticker}`}>{open}
    <div className={styles.head}><Tile ticker={ticker} /><div className={styles.who}><h3 className={styles.name}>{title}</h3></div>{eye}</div>
    <span className={styles.stars} aria-label={ja ? "数字は非表示です" : "Numbers hidden"}>＊＊＊＊＊</span></section>
    <p className={styles.credit}>{ja ? "提供：Twelve Data" : "Data: Twelve Data"}</p></>;
  const header = <div className={styles.head}>
    <Tile ticker={ticker} size={variant === "dial" ? "dial" : "gauge"} />
    <div className={styles.who}><h3 className={styles.name}>{title}</h3><span className={styles.state}><Status quote={quote} ja={ja} /></span></div>{eye}
  </div>;
  const priceText = plain(quote.price);
  return <><section className={`${styles.card} ${frame}`} aria-label={`${title} ${ticker}`}>{open}{header}
    {variant === "gauge" ? <>
      <div className={styles.priceRow}>
        <span className={styles.priceLine}><span className={styles.price}>{priceText}</span><span className={styles.usd}>{quote.currency}</span></span>
        <span className={styles.moves}><span className={`${styles.chip} ${styles[tone]}`}>{arrow} {quote.percentChange === null ? "—" : signedPercent(quote.percentChange)}</span>
          <span className={`${styles.amount} ${styles[tone]}`}>{quote.change === null ? "" : signedMoney(quote.change, quote.currency)}</span></span>
      </div>
      <Extended quote={quote} ja={ja} />
      <div className={styles.lower}>
        <div className={styles.gauges}>
          <Gauge ja={ja} label={ja ? "本日の値幅" : "Today's range"} low={quote.low ?? null} high={quote.high ?? null} price={quote.price} />
          <Gauge ja={ja} label={ja ? "52週の値幅" : "52-week range"} low={quote.week52Low ?? null} high={quote.week52High ?? null} price={quote.price} />
        </div>
        <div className={styles.statRows}>
          <div className={styles.statRow}><span>EPS</span><span>{eps(facts?.eps)}</span></div>
          <div className={styles.statRow}><span>{ja ? "時価総額" : "Mkt cap"}</span><span>{facts?.marketCap ? compact(facts.marketCap) : "—"}</span></div>
          <div className={styles.statRow}><span>{ja ? "配当利回り" : "Div. yield"}</span><span>{facts?.dividendYield == null ? "—" : `${facts.dividendYield.toFixed(2)}%`}</span></div>
          <div className={styles.statRow}><span>{ja ? "次回決算" : "Next earnings"}</span><span>{dateJa(facts?.nextEarnings ?? null, ja ? "ja" : "en")}</span></div>
        </div>
      </div>
    </> : <>
      <div className={styles.priceRow}>
        <div className={styles.dialLeft}>
          <span className={styles.priceLine}><span className={`${styles.price} ${priceText.length >= 7 ? styles.priceSmall : ""}`}>{priceText}</span><span className={styles.usd}>{quote.currency}</span></span>
          <span className={`${styles.both} ${styles[tone]}`}>{quote.change === null || quote.percentChange === null ? "—" : signedBoth(quote.change, quote.percentChange)}</span>
        </div>
        <Dial position={rangePosition(quote.price, quote.week52Low ?? null, quote.week52High ?? null)} low={quote.week52Low ?? null} high={quote.week52High ?? null} label={ja ? "52週の位置" : "52-week position"} />
      </div>
      <Extended quote={quote} ja={ja} />
      <dl className={styles.facts}>
        <div><dt>EPS</dt><dd>{eps(facts?.eps)}</dd></div>
        <div><dt>{ja ? "時価総額" : "Mkt cap"}</dt><dd>{facts?.marketCap ? compact(facts.marketCap) : "—"}</dd></div>
        <div><dt>{ja ? "配当利回り" : "Div. yield"}</dt><dd>{facts?.dividendYield == null ? "—" : `${facts.dividendYield.toFixed(2)}%`}</dd></div>
        <div><dt>{ja ? "次回決算" : "Next earnings"}</dt><dd>{dateJa(facts?.nextEarnings ?? null, ja ? "ja" : "en")}</dd></div>
      </dl>
    </>}
  </section><p className={styles.credit}>{ja ? "提供：Twelve Data" : "Data: Twelve Data"}</p></>;
}
