import { usableFavoriteQuote, type FavoriteQuote } from "./favorite-lists.ts";
export type WatchlistSession = "auto" | "regular" | "pre" | "closed";

// Selecting a session must not relabel another session's prices or history.
export function quoteForSession(quote: FavoriteQuote | undefined, ticker: string, session: WatchlistSession): FavoriteQuote | null {
  if (!usableFavoriteQuote(quote, ticker)) return null;
  if (session === "auto" || quote.session === session) return quote;
  if (session === "pre" && quote.extended?.session === "pre") {
    const ext = quote.extended;
    if (!Number.isFinite(ext.price) || ext.price <= 0 || !Number.isFinite(ext.percentChange) || !Number.isFinite(Date.parse(ext.asOf))) return null;
    // No pre-market path or dollar change is present in this legacy snapshot.
    return { ...quote, price: ext.price, percentChange: ext.percentChange, change: null, asOf: ext.asOf, session: "pre", history: undefined, extended: undefined };
  }
  return null;
}
