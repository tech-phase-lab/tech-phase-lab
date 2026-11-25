import type { FavoriteQuote } from "./favorite-lists.ts";

/** A row's chart is not taken away by one answer without it (owner, Nov 25: NVDA, TSM and AMD showed 「—」). The server reads at most eight
 * sparklines from the provider per request and sends none for a symbol it could not read this time (a refused minute, a read not made yet); the
 * row keeps the 5-minute path it already had. Only that path is carried over; the price and change are always the new answer's. */
export function keepHistory<T extends Pick<FavoriteQuote, "history">>(old: Record<string, T> | null, next: Record<string, T>): Record<string, T> {
  if (!old) return next;
  const out: Record<string, T> = { ...next };
  for (const [ticker, quote] of Object.entries(next)) {
    const before = old[ticker]?.history;
    if (!quote.history?.length && before?.length) out[ticker] = { ...quote, history: before };
  }
  return out;
}
