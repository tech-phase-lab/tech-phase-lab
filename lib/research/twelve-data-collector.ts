import "server-only";
import { unstable_cache } from "next/cache";
import { prepareTwelveComparisonForDisplay } from "./twelve-data-comparison-server";
import { normalizeTwelveComparison } from "./twelve-data-comparison";
import type { TwelveComparisonBundle } from "./twelve-data-financials";

/** Server-side Twelve Data collector for the comparison screen. The key stays in TWELVE_DATA_API_KEY and never reaches the browser.
 * Each endpoint is optional except the income statement: one missing endpoint leaves its score as "—", never a zero. */
const BASE = () => process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com";
export const twelveComparisonConfigured = () => !!process.env.TWELVE_DATA_API_KEY;

async function call(path: string, params: Record<string, string>, key: string): Promise<unknown | null> {
  const url = new URL(`${BASE()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", key);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      // Out of credits for this minute (610 per minute; one company's statements cost about 250): wait for the next minute.
      if (response.status === 429 && attempt < 2) { await new Promise(r => setTimeout(r, 20_000)); continue; }
      const body = await response.json().catch(() => ({})) as { status?: unknown; code?: unknown; message?: unknown };
      // The provider's own reason (never the key) goes to the log so a refused call can be told apart from a missing plan.
      if (!response.ok || body?.status === "error") {
        console.warn(`twelve-data ${path} ${params.symbol} ${response.status} ${String(body?.code ?? "")} ${String(body?.message ?? "").slice(0, 160)}`);
        if (body?.code === 429 && attempt < 2) { await new Promise(r => setTimeout(r, 20_000)); continue; }
        if (response.status === 400 && params.outputsize && attempt === 0) { delete params.outputsize; url.searchParams.delete("outputsize"); continue; }
        return null;
      }
      return body;
    } catch { console.warn(`twelve-data ${path} ${params.symbol} failed`); return null; }
  }
  return null;
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

/** Six-hour cache per ticker, shared by every pairing (the factors accept statistics up to 36 hours old). A failure is never cached. */
const cached = unstable_cache(async (ticker: string) => {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("not-configured");
  // One company at a time: its four calls cost about 250 credits, and two at once (plus a retry) went over the 610 per minute (owner, Nov 11).
  const bundle = await serial(() => fetchTwelveBundle(ticker, key));
  if (!bundle) throw new Error("twelve-unavailable");
  return prepareTwelveComparisonForDisplay(bundle);
}, ["twelve-comparison-collector-v1"], { revalidate: 6 * 3600 });

export async function loadTwelveComparison(ticker: string) {
  if (!twelveComparisonConfigured()) return null;
  try { return await cached(ticker); } catch (error) { console.warn(`twelve-data comparison ${ticker}: ${error instanceof Error ? error.message : "failed"}`); return null; }
}
