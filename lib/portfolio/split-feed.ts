import "server-only";
import { unstable_cache } from "next/cache";
import { parseSplits, type Split } from "./splits";

/** Stock splits of the tickers a reader holds (Twelve Data /splits, last year). Six-hour cache per ticker; a failed read is never cached. */
const BASE = () => process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com";
const one = (ticker: string) => unstable_cache(async (): Promise<Split[]> => {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  const url = new URL(`${BASE()}/splits`);
  url.searchParams.set("symbol", ticker); url.searchParams.set("range", "1y"); url.searchParams.set("apikey", key);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`splits ${response.status}`);
  return parseSplits(await response.json(), ticker);
}, ["portfolio-splits-v1", ticker], { revalidate: 6 * 3600 })();
export async function loadSplits(tickers: string[]): Promise<Record<string, Split[]>> {
  const out: Record<string, Split[]> = {};
  await Promise.all(tickers.map(async ticker => { try { out[ticker] = await one(ticker); } catch (error) { console.warn(`splits ${ticker}: ${error instanceof Error ? error.message : "failed"}`); } }));
  return out;
}
