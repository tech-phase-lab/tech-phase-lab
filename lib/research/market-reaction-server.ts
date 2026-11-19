import "server-only";
import { loadDailyCloses, marketDataConfigured } from "./market-data";
import { benchmarkFor, marketReaction, type MarketReaction } from "./market-reaction";

/** The next-day market reaction of each earnings analysis (owner, Nov 18), from the Twelve Data daily series the stock pages already read
 * (one credit per symbol, kept 30 minutes by market-data.ts). A finished reaction (five points: the session after has closed too) never changes
 * and is kept for the life of the process. Any failure leaves the reaction out: the section is simply not shown. */
const done = new Map<string, MarketReaction>();
const MAX_AGE_MS = 45 * 86400_000;

export async function loadMarketReaction(ticker: string, releasedAt: string, now = Date.now()): Promise<MarketReaction | null> {
  const key = `${ticker}|${releasedAt}`;
  const hit = done.get(key);
  if (hit) return hit;
  const released = Date.parse(releasedAt);
  if (!marketDataConfigured() || !Number.isFinite(released) || now - released > MAX_AGE_MS || now - released < 0) return null;
  try {
    const benchmark = benchmarkFor(ticker);
    const [stock, bench] = await Promise.all([loadDailyCloses(ticker), loadDailyCloses(benchmark.symbol).catch(() => null)]);
    const reaction = marketReaction(stock, bench, benchmark, releasedAt, now);
    if (reaction && reaction.series.length === 5 && reaction.releaseIndex === 3 && reaction.benchmark) {
      if (done.size > 200) done.clear();
      done.set(key, reaction);
    }
    return reaction;
  } catch {
    return null;
  }
}
