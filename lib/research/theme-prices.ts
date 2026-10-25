import "server-only";
import { unstable_cache } from "next/cache";
import { tickersOf, type GroupId } from "./theme-definitions.ts";
import { stockReturns, type CloseSeries, type StockReturns } from "./theme-ranking.ts";

/** Server-side Twelve Data collector for the Theme Ranking. The key lives only in the environment
 * (TWELVE_DATA_API_KEY); without it nothing is invented, the screen simply says the data is not connected yet. */
const BASE = () => process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com";
const CHUNK = 12; // stays inside the per-minute credit limit of the smaller plans; the result is cached below
const HISTORY = 70; // trading days: enough for the 3-month (63-day) look-back

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
    out.push({ ticker, closes: bars.map(bar => Number(bar.close)), asOf: String(bars[0].datetime).slice(0, 10) });
  }
  return out;
}

async function fetchChunk(symbols: string[], key: string): Promise<CloseSeries[]> {
  const url = new URL(`${BASE()}/time_series`);
  url.searchParams.set("symbol", symbols.join(","));
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", String(HISTORY));
  url.searchParams.set("apikey", key);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Twelve Data ${response.status}`);
  return parseTimeSeries(await response.json(), symbols);
}

async function collect(group: GroupId): Promise<{ stocks: StockReturns[]; asOf: string }> {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  const tickers = tickersOf(group);
  const series: CloseSeries[] = [];
  for (let i = 0; i < tickers.length; i += CHUNK) series.push(...await fetchChunk(tickers.slice(i, i + CHUNK), key));
  if (!series.length) throw new Error("no-data");
  return { stocks: series.map(stockReturns), asOf: series.map(item => item.asOf).sort().at(-1)! };
}

/** Ten-minute cache per group, shared by every reader and fetched only when someone opens that group,
 * so the credits follow what is actually looked at; a failed fetch is never cached (unstable_cache throws through). */
export const loadThemeReturns = (group: GroupId) =>
  unstable_cache(() => collect(group), ["theme-ranking-returns-v2", group], { revalidate: 600 })();
