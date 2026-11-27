import "server-only";
import { unstable_cache } from "next/cache";
import { etDay, knownThroughDay, mergeSplits, parseTwelveSplits, type StockSplit } from "@/lib/research/stock-splits";
import { providerLimited, reserveCredits } from "@/lib/research/twelve-gateway";
import { durableGet, durablePut } from "@/lib/research/twelve-copies";

/** Stock splits of the tickers a reader holds: Twelve Data /splits (whole history, 20 credits a call) with the manual list
 * (lib/research/stock-splits.json) laid over it. Kept per ticker in the shared data cache for the ET day (readers share one call per ticker a
 * day), with the time it was read: `through` is the day before that, so a cached answer can never date a lot past a split it could not yet
 * list. A failed read (non-200, a 429 or other error body, a timeout) throws, is never cached and puts the ticker in `failed`: it is absent
 * from `splits`, and the screen leaves that ticker's lots alone (it may apply the manual list, never advance their date to today). */
const BASE = () => process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com";
const one = (ticker: string) => unstable_cache(async (): Promise<{ splits: StockSplit[]; at: number }> => {
  // 20 credits a ticker a day: the monitor's copy of today's read first (production, Nov 26: the runtime cache loses entries within hours).
  const kept = (await durableGet("portfolio-splits", [ticker]).catch(() => ({})) as Record<string, { at: number; value: unknown }>)[ticker];
  if (kept && Array.isArray(kept.value) && etDay(kept.at) === etDay()) return { splits: kept.value as StockSplit[], at: kept.at };
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  const url = new URL(`${BASE()}/splits`);
  url.searchParams.set("symbol", ticker); url.searchParams.set("range", "full"); url.searchParams.set("apikey", key);
  await reserveCredits(20, "user", "portfolio-splits"); // inside the site's share of the plan's minute; a refusal is a failed read (not cached, the lots are left alone)
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (response.status === 429) providerLimited();
  if (!response.ok) throw new Error(`splits ${response.status}`);
  const read = { splits: parseTwelveSplits(await response.json(), ticker), at: Date.now() };
  await durablePut("portfolio-splits", ticker, { at: read.at, value: read.splits }).catch(() => false);
  return read;
}, ["portfolio-splits-v4", ticker, etDay()], { revalidate: 12 * 3600 })();
export async function loadSplits(tickers: string[]): Promise<{ splits: Record<string, StockSplit[]>; through: Record<string, string>; failed: string[] }> {
  const splits: Record<string, StockSplit[]> = {}, through: Record<string, string> = {}, failed: string[] = [];
  await Promise.all(tickers.map(async ticker => {
    try { const read = await one(ticker); splits[ticker] = mergeSplits(ticker, read.splits); through[ticker] = knownThroughDay(read.at); }
    catch (error) { failed.push(ticker); console.warn(`splits ${ticker}: ${error instanceof Error ? error.message : "failed"}`); }
  }));
  return { splits, through, failed };
}
