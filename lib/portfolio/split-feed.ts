import "server-only";
import { unstable_cache } from "next/cache";
import { mergeSplits, parseTwelveSplits, type StockSplit } from "@/lib/research/stock-splits";

/** Stock splits of the tickers a reader holds: Twelve Data /splits (whole history) with the manual list (lib/research/stock-splits.json)
 * laid over it. Six-hour cache per ticker; a failed read is never cached. A ticker whose read failed is listed in `failed` and still gets
 * the manual list (SNDK 8-for-1 is there), so a known split is never missed. */
const BASE = () => process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com";
const one = (ticker: string) => unstable_cache(async (): Promise<StockSplit[]> => {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  const url = new URL(`${BASE()}/splits`);
  url.searchParams.set("symbol", ticker); url.searchParams.set("range", "full"); url.searchParams.set("apikey", key);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`splits ${response.status}`);
  return parseTwelveSplits(await response.json(), ticker);
}, ["portfolio-splits-v2", ticker], { revalidate: 6 * 3600 })();
export async function loadSplits(tickers: string[]): Promise<{ splits: Record<string, StockSplit[]>; failed: string[] }> {
  const splits: Record<string, StockSplit[]> = {}, failed: string[] = [];
  await Promise.all(tickers.map(async ticker => {
    try { splits[ticker] = mergeSplits(ticker, await one(ticker)); }
    catch (error) { failed.push(ticker); splits[ticker] = mergeSplits(ticker, []); console.warn(`splits ${ticker}: ${error instanceof Error ? error.message : "failed"}`); }
  }));
  return { splits, failed };
}
