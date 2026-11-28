/** A stock page's live price (owner, Nov 27: the price did not move while the page was open). While U.S. stocks trade (4:00–20:00 New York
 * time on weekdays, lib/research/twelve-budget.ts stocksTrading) the page asks our quotes route every 15 seconds — the market board's own
 * cadence — through `poll` (app/research/price/polling.ts startPolling: a hidden tab asks for nothing). Outside those hours it asks once.
 * The route answers from the shared copy (one provider read per symbol and slot for every viewer), so a viewer never adds a provider read
 * of its own. No imports, so it can be tested directly. */
export const LIVE_QUOTE_MS = 15_000;
/** One ticker (a stock's page) or several in one request (the 監視22銘柄 list: all 22 in a single batched read, within the route's
 * MAX_QUOTES_PER_REQUEST of lib/research/twelve-budget.ts). */
export const liveQuoteUrl = (tickers: string | readonly string[]) => `/api/research/market/quotes?tickers=${(typeof tickers === "string" ? [tickers] : tickers).map(encodeURIComponent).join(",")}&fast=1`;
export function startLiveQuote(trading: boolean, read: () => Promise<void>, poll: (task: () => Promise<void>, every: number) => () => void): () => void {
  if (trading) return poll(read, LIVE_QUOTE_MS);
  void read();
  return () => {};
}
