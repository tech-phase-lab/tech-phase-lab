import { parseBars } from "../research/market-quote.ts";
import type { TwelveLease } from "./twelve-lease.ts";

/** Daily bars for many symbols at once (Twelve Data /time_series, interval=1day): up to BATCH_SYMBOLS symbols in one request, one credit
 * per symbol, each request leased first (twelve-lease.ts). Never retried: a 429 pauses the lease to the next minute and the batch is a
 * failed read. The key is only in the request URL, never in a result or a log. */
export const BATCH_SYMBOLS = 50;
export const SYMBOL = /^[A-Z][A-Z0-9./-]{0,14}$/;
export type DailyBar = { date: string; close: number };
/** Per symbol: its bars (oldest first), `[]` when the provider said the symbol has no such series (not asked again that day), or
 * null when the read failed or was not granted (asked again next time). */
export type DailyAnswer = Map<string, DailyBar[] | null>;

type Fetcher = (input: URL, init?: RequestInit) => Promise<Response>;
export type DailyBatchOptions = { apiKey: string | undefined; lease: TwelveLease; caller: string; fetcher?: Fetcher; baseUrl?: string; outputsize?: number; endDate?: string };

const dayAfter = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
export { dayAfter };

/** One symbol's part of a reply. A different symbol's answer, an error body or a non-USD series is never taken. */
function readOne(entry: unknown, symbol: string): DailyBar[] | null {
  const body = entry && typeof entry === "object" ? entry as { status?: unknown; code?: unknown; meta?: { symbol?: unknown; currency?: unknown } } : null;
  if (!body) return null;
  // The provider's "no such symbol" (400 / 404 for this symbol only) is an answer: nothing to read for it today.
  if (body.status === "error") return body.code === 400 || body.code === 404 ? [] : null;
  if (typeof body.meta?.symbol === "string" && body.meta.symbol.toUpperCase() !== symbol) return null;
  if (typeof body.meta?.currency === "string" && body.meta.currency !== "USD") return [];
  return parseBars(body).map(b => ({ date: b.at.slice(0, 10), close: b.close }));
}

export async function fetchDailyBatch(symbols: readonly string[], options: DailyBatchOptions): Promise<DailyAnswer> {
  const out: DailyAnswer = new Map();
  const wanted = [...new Set(symbols)].filter(s => SYMBOL.test(s));
  for (const s of symbols) if (!SYMBOL.test(s)) out.set(s, null);
  if (!options.apiKey) { for (const s of wanted) out.set(s, null); return out; }
  const request = options.fetcher ?? ((input, init) => fetch(input, init));
  const base = options.baseUrl ?? "https://api.twelvedata.com";
  for (let i = 0; i < wanted.length; i += BATCH_SYMBOLS) {
    const chunk = wanted.slice(i, i + BATCH_SYMBOLS);
    for (const s of chunk) out.set(s, null);
    if (!await options.lease.take(chunk.length, options.caller)) continue; // not granted before the deadline: a failed read
    const url = new URL(`${base}/time_series`);
    const params: Record<string, string> = { symbol: chunk.join(","), interval: "1day", outputsize: String(options.outputsize ?? 5), order: "desc",
      ...(options.endDate ? { end_date: options.endDate } : {}), apikey: options.apiKey };
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    try {
      const response = await request(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) });
      if (response.status === 429) { options.lease.limited(); await response.body?.cancel(); continue; }
      if (response.status !== 200) { await response.body?.cancel(); continue; }
      const body = await response.json() as Record<string, unknown> & { status?: unknown; code?: unknown };
      // A whole-request error (a 429 comes back as a 200 with code 429): nothing in it is taken, and nothing is asked again this minute.
      if (body?.status === "error" && body.code === 429) { options.lease.limited(); continue; }
      if (body?.status === "error" && chunk.length > 1) continue;
      for (const s of chunk) out.set(s, readOne(chunk.length === 1 ? body : body[s], s));
    } catch { /* timeout or unreadable: a failed read */ }
  }
  return out;
}
