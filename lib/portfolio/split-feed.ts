import "server-only";
import { unstable_cache } from "next/cache";
import { mergeSplits, parseTwelveSplits, type StockSplit } from "@/lib/research/stock-splits";

/** Stock splits of the tickers a reader holds: Twelve Data /splits (whole history, 20 credits a call) with the manual list
 * (lib/research/stock-splits.json) laid over it. Kept a day per ticker in the shared data cache, so readers share one call per ticker a day.
 * A failed read (non-200, a 429 or other error body, a timeout) throws, is never cached and puts the ticker in `failed`: it is absent from
 * `splits`, and the screen then leaves that ticker's check date alone (it may apply the manual list, never advance the date to today). */
const BASE = () => process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com";
const one = (ticker: string) => unstable_cache(async (): Promise<StockSplit[]> => {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  const url = new URL(`${BASE()}/splits`);
  url.searchParams.set("symbol", ticker); url.searchParams.set("range", "full"); url.searchParams.set("apikey", key);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`splits ${response.status}`);
  return parseTwelveSplits(await response.json(), ticker);
}, ["portfolio-splits-v3", ticker], { revalidate: 24 * 3600 })();
export async function loadSplits(tickers: string[]): Promise<{ splits: Record<string, StockSplit[]>; failed: string[] }> {
  const splits: Record<string, StockSplit[]> = {}, failed: string[] = [];
  await Promise.all(tickers.map(async ticker => {
    try { splits[ticker] = mergeSplits(ticker, await one(ticker)); }
    catch (error) { failed.push(ticker); console.warn(`splits ${ticker}: ${error instanceof Error ? error.message : "failed"}`); }
  }));
  return { splits, failed };
}
