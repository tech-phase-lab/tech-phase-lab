"use client";
import { useEffect, useRef, useState } from "react";
import { useStockFavorites } from "../use-stock-favorites";
import { useQuotes, shortName } from "../price/use-market";
import StockLogo from "../watchlist/stock-logo";
import AreaChart from "../watchlist/area-chart";
import { useWatchlistSectors } from "../watchlist/use-watchlist-sectors";
import { useQuoteClock } from "../watchlist/use-quote-clock";
import { favoriteIntradayChart } from "@/lib/research/watchlist-chart";
import { quoteForSession } from "@/lib/research/watchlist-session";
import { searchCardQuote, searchExtendedLine, searchQuoteTickers, searchResultName, searchResultTag, tagNeedsProfile } from "@/lib/research/search-result-card";
import type { SectorLabel } from "@/lib/research/watchlist-sector";
import { showWatchToast } from "../price/star-button";
import styles from "./search-redesign.module.css";

import type { StockDirectoryEntry } from "@/lib/research/stock-directory";
type Entry = StockDirectoryEntry;
const keyOf = (entry: Entry) => `${entry.ticker}:${entry.cik}:${entry.exchange}`;
const number = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`;
const toneOf = (value: number | null | undefined) => value == null || value === 0 ? "flat" : value > 0 ? "up" : "down";

/** The search results (owner, Nov 25; design sheet 01_銘柄検索_検索結果): one card per stock, every card the same height however many there are.
 * Logo; the ticker large with the company name and the watchlist's tag under it (the tag moves to its own line when it does not fit, never cut
 * with an ellipsis); the watchlist's intraday sparkline without its high / low figures; the price, ▲▼ and the day's change, and while pre-market /
 * after-hours trading is under way 「時間外 +0.46%」 (none without extended data), all right-aligned in tabular figures; the star.
 * Prices, sparklines and SEC tags are read only for cards that have been on screen, in one batched quotes request (the Twelve Data lease path). */
export default function SearchRows({ results, lang, onSelect, sectors = {} }: { results: Entry[]; lang: "ja" | "en"; onSelect: (entry: Entry) => unknown; sectors?: Record<string, SectorLabel> }) {
  const ja = lang === "ja";
  const favorites = useStockFavorites();
  const now = useQuoteClock();
  const list = useRef<HTMLUListElement>(null);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const resultKey = results.map(keyOf).join("|");
  useEffect(() => {
    const root = list.current;
    if (!root) return;
    const mark = (tickers: string[]) => setSeen(previous => tickers.every(ticker => previous.has(ticker)) ? previous : new Set([...previous, ...tickers]));
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-ticker]"));
    // Without an observer (old browsers), the first screenful.
    if (typeof IntersectionObserver === "undefined") { mark(cards.slice(0, 8).map(card => card.dataset.ticker ?? "")); return; }
    const observer = new IntersectionObserver(entries => {
      const shown = entries.filter(entry => entry.isIntersecting).map(entry => (entry.target as HTMLElement).dataset.ticker ?? "").filter(Boolean);
      if (shown.length) mark(shown);
    }, { rootMargin: "160px 0px" });
    for (const card of cards) observer.observe(card);
    return () => observer.disconnect();
  }, [resultKey]);
  const tickers = searchQuoteTickers(results, seen);
  // Every 60 seconds (the server keeps a quote about a minute); `keep`: cards already drawn keep their numbers while newly shown ones are added.
  const { data } = useQuotes(tickers, true, false, true);
  const fetchedSectors = useWatchlistSectors(tickers.filter(ticker => tagNeedsProfile(ticker, sectors[ticker])));
  return <ul className={styles.list} ref={list}>{results.map(entry => {
    const quote = searchCardQuote(data?.[entry.ticker], entry.ticker);
    const tone = toneOf(quote?.percentChange);
    const extended = searchExtendedLine(quote, now);
    // The chart is the watchlist row's own: the day's 5-minute closes, with the latest price as its last point.
    const shown = quote ? quoteForSession(quote, entry.ticker, "auto") : null;
    const chart = shown ? favoriteIntradayChart(shown) : null;
    const values = chart && shown && Date.parse(shown.asOf) > Date.parse(chart.end) && shown.price !== chart.values[chart.values.length - 1] ? [...chart.values, shown.price] : chart?.values;
    const tag = searchResultTag(entry.ticker, sectors[entry.ticker], fetchedSectors[entry.ticker])?.[lang];
    const name = searchResultName(entry.ticker, shortName((quote ? data?.[entry.ticker]?.name : undefined) ?? entry.name), lang);
    const registered = favorites.lists.some(item => item.tickers.includes(entry.ticker));
    return <li className={styles.row} key={keyOf(entry)} data-ticker={entry.ticker}>
      <button type="button" className={styles.main} onClick={() => onSelect(entry)} aria-label={`${entry.name} ${entry.ticker}`}>
        <StockLogo ticker={entry.ticker} className={styles.tile} />
        <span className={styles.names}>
          <b>{entry.ticker}</b>
          <span className={styles.nameLine} data-long={name.length > 18 || undefined}><span className={styles.name}>{name}</span>{tag && <span className={styles.tag}>{tag}</span>}</span>
        </span>
        <span className={styles.spark}>{chart && values ? <AreaChart className={styles.sparkChart} values={values} reference={chart.reference} levels={false} label={ja ? `${entry.ticker}の当日の値動き` : `${entry.ticker} intraday trend`} /> : null}</span>
        <span className={styles.quote}>
          <b>{quote ? number(quote.price) : "—"}</b>
          <span className={styles[tone]}>{quote?.percentChange == null ? "" : `${tone === "up" ? "▲ " : tone === "down" ? "▼ " : ""}${percent(quote.percentChange)}`}</span>
          {extended && <span className={styles.extended}><small className={styles.extTag}>{extended.session === "pre" ? (ja ? "プレ" : "Pre") : (ja ? "時間外" : "After")}</small><span className={styles[toneOf(extended.percentChange)]}>{percent(extended.percentChange)}</span></span>}
        </span>
      </button>
      <button type="button" className={styles.star} aria-pressed={registered} disabled={!favorites.editable} aria-label={registered ? (ja ? `${entry.ticker}をウォッチリストから外す` : `Remove ${entry.ticker} from watchlist`) : (ja ? `${entry.ticker}をウォッチリストに追加` : `Add ${entry.ticker} to watchlist`)}
        onClick={() => {
          if (registered) { for (const item of favorites.lists) if (item.tickers.includes(entry.ticker)) favorites.setMembership(item.id, entry.ticker, false); showWatchToast(ja ? "ウォッチリストから外しました" : "Removed from watchlist"); }
          else if (favorites.toggle(entry.ticker, entry.name)) showWatchToast(ja ? "ウォッチリストに追加しました" : "Added to watchlist");
        }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill={registered ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" /></svg>
      </button>
    </li>;
  })}</ul>;
}
