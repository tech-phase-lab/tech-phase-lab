import type { RadarFacts } from "./radar-facts";

/** Financial Radar numbers are kept by a dedicated storage API (never the browser, never the database directly).
 * The site's server saves when a filing shows up and only reads the stored values when a page opens.
 * Until all three settings exist, the radar keeps computing from SEC as before. */
export type StoredRow = {
  genre: string; ticker: string; ocf_margin: number; cover: number; revenue_growth: number | null; revenue_usd: number;
  period_end: string; previous_ocf_margin: number | null; previous_cover: number | null; needs_review: boolean;
  calculated_at: string; fcf_margin: number | null; basis: "annual" | "ttm" | null; previous_period_end: string | null;
};
export type StoreConfig = { url: string; write: string; read: string };

const SECRET = /^[A-Za-z0-9_-]{32,256}$/;
/** null unless the address and both secrets are set (the secrets must differ). */
export function storeConfig(env: Record<string, string | undefined> = process.env): StoreConfig | null {
  const { TECH_PHASE_RADAR_API_URL: raw, TECH_PHASE_RADAR_WRITE_TOKEN: write, TECH_PHASE_RADAR_READ_TOKEN: read } = env;
  if (!raw || !write || !read || !SECRET.test(write) || !SECRET.test(read) || write === read) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return { url: url.origin, write, read };
  } catch { return null; }
}

const finite = (value: number) => Number.isFinite(value) ? value : 1000; // same stand-in for "no borrowing" as the chart

/** The row to save, or null when the calculation did not succeed (then nothing is saved and the last good values stay). */
export function toRow(genre: string, ticker: string, facts: RadarFacts, calculatedAt: number, reviewAbove: number): StoredRow | null {
  const latest = facts.latest;
  if (!latest || facts.reason || latest.noRevenue) return null; // no revenue: nothing to store (the figure is a stand-in), it is calculated live
  const numbers = [latest.ocfMargin, latest.revenue, latest.fcfMargin];
  if (numbers.some(value => !Number.isFinite(value)) || Number.isNaN(latest.cover) || latest.cover < 0 || latest.revenue < 0) return null;
  const before = facts.previous;
  const hasBefore = before !== null && Number.isFinite(before.ocfMargin) && !Number.isNaN(before.cover) && before.cover >= 0;
  return {
    genre, ticker, ocf_margin: latest.ocfMargin, cover: finite(latest.cover),
    revenue_growth: latest.revenueGrowth !== null && Number.isFinite(latest.revenueGrowth) ? latest.revenueGrowth : null,
    revenue_usd: latest.revenue, period_end: latest.end,
    previous_ocf_margin: hasBefore ? before.ocfMargin : null, previous_cover: hasBefore ? finite(before.cover) : null,
    needs_review: latest.ocfMargin > reviewAbove, calculated_at: new Date(calculatedAt).toISOString().replace(/\.\d{3}Z$/, "Z"),
    fcf_margin: latest.fcfMargin, basis: latest.basis, previous_period_end: hasBefore ? before.end : null,
  };
}

/** Back from a stored row to what the chart builder takes. The previous earnings' revenue is not stored; the colour then comes from year-on-year growth. */
export function factsFromRow(row: StoredRow): RadarFacts {
  return {
    latest: { end: row.period_end, basis: row.basis ?? "ttm", revenue: row.revenue_usd, ocfMargin: row.ocf_margin, fcfMargin: row.fcf_margin ?? 0, cover: row.cover, revenueGrowth: row.revenue_growth },
    previous: row.previous_ocf_margin !== null && row.previous_cover !== null && row.previous_period_end
      ? { end: row.previous_period_end, basis: row.basis ?? "ttm", revenue: 0, ocfMargin: row.previous_ocf_margin, fcfMargin: 0, cover: row.previous_cover, revenueGrowth: null }
      : null,
  };
}

const isRow = (value: unknown): value is StoredRow => {
  const row = value as Partial<StoredRow> | null;
  return !!row && typeof row.ticker === "string" && typeof row.ocf_margin === "number" && typeof row.cover === "number" && typeof row.revenue_usd === "number"
    && typeof row.period_end === "string" && typeof row.calculated_at === "string";
};

/** Stored rows of one genre keyed by ticker, or null when the storage cannot be read (the caller then computes as before). */
export async function readRows(genre: string, config = storeConfig(), fetcher: typeof fetch = fetch): Promise<Map<string, StoredRow> | null> {
  if (!config) return null;
  try {
    const response = await fetcher(`${config.url}/v1/financial-radar?genre=${encodeURIComponent(genre)}`, { cache: "no-store", headers: { Authorization: `Bearer ${config.read}`, Accept: "application/json" }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const body = await response.json() as { ok?: boolean; items?: unknown };
    if (body.ok !== true || !Array.isArray(body.items)) return null;
    return new Map(body.items.filter(isRow).map(row => [row.ticker, row]));
  } catch { return null; }
}

/** True when saved (or already held there as the same/newer result). Retries a temporary failure twice; a same result sent again is safe. */
export async function saveRow(row: StoredRow, config = storeConfig(), fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!config) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(`${config.url}/v1/financial-radar`, { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${config.write}`, "Content-Type": "application/json" }, body: JSON.stringify(row), signal: AbortSignal.timeout(5000) });
      if (response.ok) return true;
      if (response.status < 500) return false;
    } catch { /* a network hiccup: try again */ }
    await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
  }
  return false;
}

/** Stored values older than this are computed again in the background, so a new filing replaces them. */
export const STALE_MS = 6 * 3600_000;
export const isStale = (row: StoredRow | undefined, now: number) => !row || now - Date.parse(row.calculated_at) > STALE_MS;
