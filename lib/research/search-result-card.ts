import { usableFavoriteQuote, type FavoriteQuote } from "./favorite-lists.ts";
import { LEVERAGED_ETFS } from "./leveraged-etfs.ts";
import { extendedIsCurrent } from "./market-quote.ts";
import { watchlistSector, type SectorLabel } from "./watchlist-sector.ts";

/** Stock search result cards (owner, Nov 25; design sheet 01_銘柄検索_検索結果). Pure helpers, shared by the cards and their tests. */

const leveragedFunds = new Map(LEVERAGED_ETFS.map(item => [item.etf, item]));
const leveraged = new Set(leveragedFunds.keys());
const LEVERAGED_TAG: SectorLabel = { ja: "レバETF", en: "Leveraged ETF" };

/** The card's tag: the watchlist's own tag (its theme list, the research roster's sector, or the SEC SIC label it reads), and for a long 2x / 3x
 * fund of the マーケット「レバETF」 list, 「レバETF」. None when nothing classifies the ticker. */
export function searchResultTag(ticker: string, registered?: SectorLabel, fetched?: SectorLabel): SectorLabel | undefined {
  return watchlistSector(ticker, registered) ?? fetched ?? (leveraged.has(ticker) ? LEVERAGED_TAG : undefined);
}

/** The card's company line: a long 2x / 3x fund of the マーケット「レバETF」 list reads 「NVDA 2倍ETF」 / "NVDA 2x ETF" (sheet 01) instead of the
 * fund's long legal name; every other name as given. */
export function searchResultName(ticker: string, name: string, lang: "ja" | "en") {
  const fund = leveragedFunds.get(ticker);
  if (!fund) return name;
  return lang === "ja" ? `${fund.underlying} ${fund.leverage}倍ETF` : `${fund.underlying} ${fund.leverage}x ETF`;
}

/** Tickers whose tag needs the SEC profile (the same per-ticker read the watchlist makes): only those the card can not label from its own lists. */
export function tagNeedsProfile(ticker: string, registered?: SectorLabel) {
  return !watchlistSector(ticker, registered) && !leveraged.has(ticker);
}

export type ExtendedLine = { session: "pre" | "post"; percentChange: number };
/** The third line (「時間外 +0.46%」 / 「プレ」): only while that pre-market / after-hours session is under way and the quote carries its price.
 * A ticker without extended data, or outside those hours, has no line at all. */
export function searchExtendedLine(quote: FavoriteQuote | null | undefined, now: number | null): ExtendedLine | null {
  const ext = quote?.extended;
  if (!quote || !ext || quote.session === "regular" || !Number.isFinite(ext.percentChange) || !Number.isFinite(ext.price) || ext.price <= 0) return null;
  if (ext.live !== true || (now !== null && !extendedIsCurrent(ext, now))) return null;
  return { session: ext.session, percentChange: ext.percentChange };
}

/** The tickers whose prices and sparklines the cards ask for: results that have been on screen, in result order, valid, once each, at most 30
 * (the quotes route draws sparklines for its first 30). Results never scrolled into view cost nothing. */
export function searchQuoteTickers(results: readonly { ticker: string }[], seen: ReadonlySet<string>, limit = 30) {
  return [...new Set(results.map(entry => entry.ticker))].filter(ticker => seen.has(ticker) && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)).slice(0, limit);
}

/** A usable quote for the card, or null (a quote for another ticker, or with no price, is never shown). */
export function searchCardQuote(quote: FavoriteQuote | null | undefined, ticker: string): FavoriteQuote | null {
  return usableFavoriteQuote(quote ?? undefined, ticker) ? quote! : null;
}

/** 「14:59 時点」 / "As of 14:59". */
export function asOfLabel(clock: string, lang: "ja" | "en") {
  return lang === "ja" ? `${clock} 時点` : `As of ${clock}`;
}
