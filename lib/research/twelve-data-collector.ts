import "server-only";
import { unstable_cache } from "next/cache";
import { prepareTwelveComparisonForDisplay } from "./twelve-data-comparison-server";
import { normalizeTwelveComparison } from "./twelve-data-comparison";
import type { TwelveComparisonBundle } from "./twelve-data-financials";
import { freshEnough } from "./fresh-enough";
export { freshEnough };
import { parseUsage, retryOnceIfLimited, shareInflight, TwelveBusyError, waitForCredits } from "./twelve-credit-gate";

/** Server-side Twelve Data collector for the comparison screen. The key stays in TWELVE_DATA_API_KEY and never reaches the browser.
 * Each endpoint is optional except the income statement: one missing endpoint leaves its score as "—", never a zero. */
const BASE = () => process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com";
export const twelveComparisonConfigured = () => !!process.env.TWELVE_DATA_API_KEY;

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function call(path: string, params: Record<string, string>, key: string): Promise<unknown | null> {
  const url = new URL(`${BASE()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", key);
  // Out of credits for this minute (610 per minute): one retry after a pause, never a chain (a chain holds the queue and spends more credits).
  return retryOnceIfLimited<unknown | null>(async () => {
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (response.status === 429) return { limited: true, value: null };
      const body = await response.json().catch(() => ({})) as { status?: unknown; code?: unknown; message?: unknown };
      // The provider's own reason (never the key) goes to the log so a refused call can be told apart from a missing plan.
      if (!response.ok || body?.status === "error") {
        console.warn(`twelve-data ${path} ${params.symbol} ${response.status} ${String(body?.code ?? "")} ${String(body?.message ?? "").slice(0, 160)}`);
        if (body?.code === 429) return { limited: true, value: null };
        if (response.status === 400 && params.outputsize) { delete params.outputsize; return { limited: false, value: await call(path, params, key) }; }
        return { limited: false, value: null };
      }
      return { limited: false, value: body };
    } catch { console.warn(`twelve-data ${path} ${params.symbol} failed`); return { limited: false, value: null }; }
  }, async ms => pause(ms));
}

export async function fetchTwelveBundle(ticker: string, key: string): Promise<TwelveComparisonBundle | null> {
  const [income, cashFlow, statistics, series] = await Promise.all([
    call("income_statement", { symbol: ticker, period: "quarterly" }, key),
    call("cash_flow", { symbol: ticker, period: "quarterly" }, key),
    call("statistics", { symbol: ticker }, key),
    call("time_series", { symbol: ticker, interval: "1day", outputsize: "100", adjust: "splits" }, key),
  ]);
  if (!income) return null;
  const at = new Date().toISOString();
  // What did not come out of the answers goes to the log with the field names the provider used (never values), so a mismatch is visible at once.
  try {
    const snap = normalizeTwelveComparison(ticker, income, cashFlow);
    if (snap.freeCashFlow === null || snap.revenueGrowthPct === null) {
      const row = (cashFlow as { cash_flow?: Record<string, unknown>[] } | null)?.cash_flow?.[0];
      console.warn(`twelve-data ${ticker} incomplete: ${snap.warnings.join(",")} growth=${snap.revenueGrowthPct === null ? "no" : "yes"} fcf=${snap.freeCashFlow === null ? "no" : "yes"} cashFlowKeys=${row ? Object.keys(row).join("|") : "none"} operating=${row && typeof row.operating_activities === "object" ? Object.keys(row.operating_activities as object).join("|") : "none"} investing=${row && typeof row.investing_activities === "object" ? Object.keys(row.investing_activities as object).join("|") : "none"}`);
    }
  } catch (error) { console.warn(`twelve-data ${ticker} unreadable: ${error instanceof Error ? error.message : "error"}`); }
  return { ticker, retrievedAt: at, income, cashFlow,
    ...(statistics ? { statistics: { payload: statistics, retrievedAt: at } } : {}),
    ...(series ? { series: { payload: series, adjust: "splits" as const, retrievedAt: at } } : {}) };
}

let chain: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> { const run = chain.then(job, job); chain = run.catch(() => undefined); return run; }

let usageMemo: { at: number; used: number | null } | null = null;
/** Credits used in the current minute (the call costs one credit); remembered for ten seconds, and forgotten after this process spends credits. */
async function readUsage(key: string): Promise<number | null> {
  if (usageMemo && Date.now() - usageMemo.at < 10_000) return usageMemo.used;
  let used: number | null = null;
  try {
    const response = await fetch(`${BASE()}/api_usage?apikey=${encodeURIComponent(key)}`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    if (response.ok) used = parseUsage(await response.json().catch(() => null));
  } catch { /* the read goes ahead without the meter */ }
  usageMemo = { at: Date.now(), used };
  return used;
}

const running = new Map<string, Promise<Awaited<ReturnType<typeof prepareTwelveComparisonForDisplay>>>>();

/** Six-hour cache per ticker, shared by every pairing (the factors accept statistics up to 36 hours old). A failure is never cached. */
async function readBundle(ticker: string) {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  // One company at a time: its four calls cost about 250 credits, and two at once (plus a retry) went over the 610 per minute (owner, Nov 11).
  // Before each read the minute's usage is checked, so prices, alerts and the thermometer keep their share; a busy minute waits, then gives up.
  const bundle = await serial(async () => {
    await waitForCredits({ readUsage: () => readUsage(key), sleep: pause, now: Date.now });
    try { return await fetchTwelveBundle(ticker, key); } finally { usageMemo = null; }
  });
  if (!bundle) throw new Error("twelve-unavailable");
  return prepareTwelveComparisonForDisplay(bundle);
}
// v2: free cash flow from the provider's stated figure when it has no capex line (Nov 14).
const cachedBundle = unstable_cache(readBundle, ["twelve-comparison-collector-v2"], { revalidate: 6 * 3600 });
/** Older than twelve hours (a quiet spell): read again rather than show a stale quarter, price or P/E. */
const cached = (ticker: string) => freshEnough(() => cachedBundle(ticker), () => readBundle(ticker), 12 * 3600_000, value => value.financials.retrievedAt);

export async function loadTwelveComparison(ticker: string) {
  if (!twelveComparisonConfigured()) return null;
  // Readers asking for the same company while it is being read share that one read.
  try { return await shareInflight(running, ticker, () => cached(ticker)); }
  catch (error) { console.warn(`twelve-data comparison ${ticker}: ${error instanceof TwelveBusyError ? "busy (credits)" : error instanceof Error ? error.message : "failed"}`); return null; }
}

type Raw = { payload: unknown; retrievedAt: string };
const runningSeries = new Map<string, Promise<Raw & { adjust: "splits" }>>();
const runningStatistics = new Map<string, Promise<Raw>>();
/** One credit; split-adjusted daily bars for the price-momentum factor. Shared by everyone for an hour; a failure is never cached. */
async function readSeries(ticker: string) {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  const payload = await call("time_series", { symbol: ticker, interval: "1day", outputsize: "100", adjust: "splits" }, key);
  if (!payload) throw new Error("series-unavailable");
  return { payload, adjust: "splits" as const, retrievedAt: new Date().toISOString() };
}
const cachedSeries = unstable_cache(readSeries, ["twelve-market-series-v1"], { revalidate: 3600 });
/** 50 credits; only the forward P/E is used from it. One shared read per company per 24 hours (the factors accept up to 36), and it waits for
 * room in the minute's credits before it is sent. */
async function readStatistics(ticker: string) {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  const payload = await serial(async () => {
    await waitForCredits({ readUsage: () => readUsage(key), sleep: pause, now: Date.now, cost: 50 });
    try { return await call("statistics", { symbol: ticker }, key); } finally { usageMemo = null; }
  });
  if (!payload) throw new Error("statistics-unavailable");
  return { payload, retrievedAt: new Date().toISOString() };
}
const cachedStatistics = unstable_cache(readStatistics, ["twelve-market-statistics-v1"], { revalidate: 24 * 3600 });



/** The provider's price-dependent inputs for a company whose financials come from the SEC. Either may be missing (busy minute, no plan,
 * unknown symbol): the matching factor is then left out, nothing is invented. */
export async function loadMarketInputs(ticker: string): Promise<{ series?: Raw & { adjust: "splits" }; statistics?: Raw }> {
  if (!twelveComparisonConfigured()) return {};
  const [series, statistics] = await Promise.allSettled([
    shareInflight(runningSeries, ticker, () => freshEnough(() => cachedSeries(ticker), () => readSeries(ticker), 2 * 3600_000)),
    shareInflight(runningStatistics, ticker, () => freshEnough(() => cachedStatistics(ticker), () => readStatistics(ticker), 30 * 3600_000)),
  ]);
  for (const [name, result] of [["series", series], ["statistics", statistics]] as const) if (result.status === "rejected") console.warn(`twelve-data ${name} ${ticker}: ${result.reason instanceof TwelveBusyError ? "busy (credits)" : result.reason instanceof Error ? result.reason.message : "failed"}`);
  return { ...(series.status === "fulfilled" ? { series: series.value } : {}), ...(statistics.status === "fulfilled" ? { statistics: statistics.value } : {}) };
}

/** Like loadTwelveComparison, but tells a busy minute apart from "no data", so the screen can say so. */
export async function loadTwelveComparisonState(ticker: string): Promise<{ data: Awaited<ReturnType<typeof loadTwelveComparison>>; busy: boolean }> {
  if (!twelveComparisonConfigured()) return { data: null, busy: false };
  try { return { data: await shareInflight(running, ticker, () => cached(ticker)), busy: false }; }
  catch (error) { const busy = error instanceof TwelveBusyError; console.warn(`twelve-data comparison ${ticker}: ${busy ? "busy (credits)" : error instanceof Error ? error.message : "failed"}`); return { data: null, busy }; }
}
