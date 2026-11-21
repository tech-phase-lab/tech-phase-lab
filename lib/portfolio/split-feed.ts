import "server-only";
import { unstable_cache } from "next/cache";
import { etDay, knownThroughDay, mergeSplits, parseTwelveSplits, type StockSplit } from "@/lib/research/stock-splits";

/** Stock splits of the tickers a reader holds: Twelve Data /splits (whole history, 20 credits a call) with the manual list
 * (lib/research/stock-splits.json) laid over it. Kept per ticker in the shared data cache for the ET day (readers share one call per ticker a
 * day), with the time it was read: `through` is the day before that, so a cached answer can never date a lot past a split it could not yet
 * list. A failed read (non-200, a 429 or other error body, a timeout) throws, is never cached and puts the ticker in `failed`: it is absent
 * from `splits`, and the screen leaves that ticker's lots alone (it may apply the manual list, never advance their date to today). */
const BASE = () => process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com";
const one = (ticker: string) => unstable_cache(async (): Promise<{ splits: StockSplit[]; at: number }> => {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  const url = new URL(`${BASE()}/splits`);
  url.searchParams.set("symbol", ticker); url.searchParams.set("range", "full"); url.searchParams.set("apikey", key);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`splits ${response.status}`);
  return { splits: parseTwelveSplits(await response.json(), ticker), at: Date.now() };
}, ["portfolio-splits-v4", ticker, etDay()], { revalidate: 12 * 3600 })();
export async function loadSplits(tickers: string[]): Promise<{ splits: Record<string, StockSplit[]>; through: Record<string, string>; failed: string[] }> {
  const splits: Record<string, StockSplit[]> = {}, through: Record<string, string> = {}, failed: string[] = [];
  await Promise.all(tickers.map(async ticker => {
    try { const read = await one(ticker); splits[ticker] = mergeSplits(ticker, read.splits); through[ticker] = knownThroughDay(read.at); }
    catch (error) { failed.push(ticker); console.warn(`splits ${ticker}: ${error instanceof Error ? error.message : "failed"}`); }
  }));
  return { splits, through, failed };
}
