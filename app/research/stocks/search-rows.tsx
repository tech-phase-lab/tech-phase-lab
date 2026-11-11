"use client";
import { useStockFavorites } from "../use-stock-favorites";
import { useQuotes, shortName } from "../price/use-market";
import StockLogo from "../watchlist/stock-logo";
import { plain, signedPercent } from "@/lib/research/market-quote";
import { showWatchToast } from "../price/star-button";
import styles from "./search-redesign.module.css";

import type { StockDirectoryEntry } from "@/lib/research/stock-directory";
type Entry = StockDirectoryEntry;
const keyOf = (entry: Entry) => `${entry.ticker}:${entry.cik}:${entry.exchange}`;

/** The search results in one frame (design sheet 01): logo, ticker and name, price and previous-day move, and a star for the watchlist. */
export default function SearchRows({ results, lang, onSelect }: { results: Entry[]; lang: "ja" | "en"; onSelect: (entry: Entry) => unknown }) {
  const ja = lang === "ja";
  const favorites = useStockFavorites();
  const { data } = useQuotes([...new Set(results.slice(0, 12).map(entry => entry.ticker))].filter(t => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)));
  return <ul className={styles.list}>{results.map(entry => {
    const quote = data?.[entry.ticker], tone = quote?.percentChange == null || quote.percentChange === 0 ? "flat" : quote.percentChange > 0 ? "up" : "down";
    const registered = favorites.lists.some(list => list.tickers.includes(entry.ticker));
    return <li className={styles.row} key={keyOf(entry)}>
      <button type="button" className={styles.main} onClick={() => onSelect(entry)} aria-label={`${entry.name} ${entry.ticker}`}>
        <StockLogo ticker={entry.ticker} className={styles.tile} />
        <span className={styles.names}><b>{entry.ticker}</b><span>{shortName(quote?.name ?? entry.name)}</span></span>
        <span className={styles.quote}><b>{quote ? plain(quote.price) : "—"}</b><span className={styles[tone]}>{quote?.percentChange == null ? "" : signedPercent(quote.percentChange)}</span></span>
      </button>
      <button type="button" className={styles.star} aria-pressed={registered} disabled={!favorites.editable} aria-label={registered ? (ja ? `${entry.ticker}をウォッチリストから外す` : `Remove ${entry.ticker} from watchlist`) : (ja ? `${entry.ticker}をウォッチリストに追加` : `Add ${entry.ticker} to watchlist`)}
        onClick={() => {
          if (registered) { for (const list of favorites.lists) if (list.tickers.includes(entry.ticker)) favorites.setMembership(list.id, entry.ticker, false); showWatchToast(ja ? "ウォッチリストから外しました" : "Removed from watchlist"); }
          else if (favorites.toggle(entry.ticker, entry.name)) showWatchToast(ja ? "ウォッチリストに追加しました" : "Added to watchlist");
        }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill={registered ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" /></svg>
      </button>
    </li>;
  })}</ul>;
}
