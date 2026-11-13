import "server-only";
import { unstable_cache } from "next/cache";
import { GROUPS, tickersOf, type GroupFilter, type GroupId } from "./theme-definitions.ts";
import { createBatcher } from "../portfolio/quote-batcher.ts";
import { stockReturns, type CloseSeries, type StockReturns } from "./theme-ranking.ts";

/** Server-side Twelve Data collector for the Theme Ranking. The key lives only in the environment
 * (TWELVE_DATA_API_KEY); without it nothing is invented, the screen simply says the data is not connected yet. */
const BASE = () => process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com";
const CHUNK = 12; // stays inside the per-minute credit limit of the smaller plans; the result is cached below
const HISTORY = 270; // trading days: the one-year look-back needs 253 bars, and the year-to-date base lies inside it

export const themePricesConfigured = () => !!process.env.TWELVE_DATA_API_KEY;

type Bar = { datetime?: unknown; close?: unknown };
type SymbolResult = { status?: unknown; values?: unknown };

/** Pure: one Twelve Data multi-symbol time_series answer into close series (newest first). */
export function parseTimeSeries(payload: unknown, wanted: readonly string[]): CloseSeries[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as Record<string, unknown>;
  const out: CloseSeries[] = [];
  for (const ticker of wanted) {
    const entry = body[ticker] as SymbolResult | undefined;
    if (!entry || entry.status !== "ok" || !Array.isArray(entry.values)) continue;
    const bars = (entry.values as Bar[]).filter(bar => typeof bar?.datetime === "string" && Number.isFinite(Number(bar.close)));
    if (!bars.length) continue;
    bars.sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)));
    out.push({ ticker, closes: bars.map(bar => Number(bar.close)), asOf: String(bars[0].datetime).slice(0, 10), dates: bars.map(bar => String(bar.datetime).slice(0, 10)) });
  }
  return out;
}

async function fetchChunk(symbols: string[], key: string): Promise<CloseSeries[]> {
  const url = new URL(`${BASE()}/time_series`);
  url.searchParams.set("symbol", symbols.join(","));
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", String(HISTORY));
  url.searchParams.set("apikey", key);
  // A per-minute credit limit answers 429; one patient retry keeps a busy minute from emptying the screen.
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (response.status === 429 && attempt === 0) { await new Promise(resolve => setTimeout(resolve, 20_000)); continue; }
    if (!response.ok) throw new Error(`Twelve Data ${response.status}`);
    const body = await response.json();
    if (body && typeof body === "object" && (body as { code?: unknown }).code === 429 && attempt === 0) { await new Promise(resolve => setTimeout(resolve, 20_000)); continue; }
    if (body && typeof body === "object" && (body as { status?: unknown }).status === "error") throw new Error(`Twelve Data ${String((body as { code?: unknown }).code)} ${String((body as { message?: unknown }).message).slice(0, 120)}`);
    // One symbol comes back unwrapped (no per-symbol key); wrap it so a lone ticker in a chunk is read like the others.
    return parseTimeSeries(symbols.length === 1 && body && typeof body === "object" && "values" in body ? { [symbols[0]]: body } : body, symbols);
  }
}

export type GroupReturns = { stocks: StockReturns[]; asOf: string; fetchedAt: number };

/** Owner, Nov 10: a stock that cannot be read is skipped and logged, never fatal; the screen fails only when nothing at all came back. */
async function collectList(tickers: string[]): Promise<GroupReturns> {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  const series: CloseSeries[] = [];
  // Chunks run side by side (a long genre read one chunk at a time ran past the 60-second limit on the first cold load) and the whole
  // read stops waiting at 40 seconds, keeping what has come back (owner, Nov 11: the screen stayed on the error message).
  const chunks: string[][] = [];
  for (let i = 0; i < tickers.length; i += CHUNK) chunks.push(tickers.slice(i, i + CHUNK));
  let next = 0, stop = false;
  const worker = async () => {
    while (!stop && next < chunks.length) {
      const chunk = chunks[next++];
      try {
        const got = await fetchChunk(chunk, key);
        series.push(...got);
        const missing = chunk.filter(ticker => !got.some(item => item.ticker === ticker));
        if (missing.length) console.warn(`theme-ranking: no data for ${missing.join(",")}`);
      } catch (error) { console.warn(`theme-ranking: chunk failed (${chunk.join(",")}): ${error instanceof Error ? error.message : "error"}`); }
    }
  };
  const deadline = new Promise<void>(resolve => setTimeout(() => { stop = true; resolve(); }, 40_000));
  await Promise.race([Promise.all(Array.from({ length: Math.min(4, chunks.length) }, worker)), deadline]);
  if (stop) console.warn(`theme-ranking: stopped waiting at 40s with ${series.length} series`);
  if (!series.length) throw new Error("no-data");
  return { stocks: series.map(stockReturns), asOf: series.map(item => item.asOf).sort().at(-1)!, fetchedAt: Date.now() };
}

/** The regular U.S. session, Monday to Friday 9:30-16:00 Eastern (holidays are not tracked: the cache only decides how often to refresh). */
export function usMarketOpen(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  const minutes = Number(get("hour")) % 24 * 60 + Number(get("minute"));
  return !["Sat", "Sun"].includes(get("weekday")) && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/** Ten minutes while the market is open, an hour once it is closed (the last close does not change), shared by every reader and
 * fetched only when someone opens that genre; a failed fetch is never cached (unstable_cache throws through). */
const loadGroup = (group: GroupId) =>
  unstable_cache(() => collectList(tickersOf(group)), ["theme-ranking-returns-v3", group], { revalidate: usMarketOpen() ? 600 : 3600 })();

export async function loadThemeReturns(group: GroupFilter): Promise<GroupReturns> {
  if (group !== "all") return loadGroup(group);
  const settled = await Promise.allSettled(GROUPS.map(item => loadGroup(item.id)));
  const done = settled.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  if (!done.length) throw new Error("no-data");
  const byTicker = new Map(done.flatMap(item => item.stocks).map(stock => [stock.ticker, stock]));
  return { stocks: [...byTicker.values()], asOf: done.map(item => item.asOf).sort().at(-1)!, fetchedAt: Math.min(...done.map(item => item.fetchedAt)) };
}

type OneReturns = { stock: StockReturns; asOf: string };
const readMany = async (tickers: string[]): Promise<Map<string, OneReturns>> => {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  return new Map((await fetchChunk(tickers, key)).map(item => [item.ticker, { stock: stockReturns(item), asOf: item.asOf }]));
};
// Only tickers that missed the cache reach this; the ones that miss together go out as one request.
const fetchReturns = createBatcher<OneReturns>(readMany, CHUNK);
/** Ten-minute cache per ticker (a symbol with no data is cached as null), shared by every reader whatever else they hold. */
const oneReturns = (ticker: string) =>
  unstable_cache(async (): Promise<OneReturns | null> => fetchReturns(ticker), ["watchlist-week-returns-v2", ticker], { revalidate: 600 })();

/** The same ten-minute cache for an arbitrary list of tickers (the 銘柄手帳 weekly moves), kept per ticker so different lists share it. */
export async function loadReturnsFor(tickers: string[]): Promise<{ stocks: StockReturns[]; asOf: string }> {
  if (!process.env.TWELVE_DATA_API_KEY) throw new Error("not-configured");
  const found = (await Promise.all([...new Set(tickers)].sort().map(oneReturns))).filter((item): item is OneReturns => !!item);
  if (!found.length) throw new Error("no-data");
  return { stocks: found.map(item => item.stock), asOf: found.map(item => item.asOf).sort().at(-1)! };
}
