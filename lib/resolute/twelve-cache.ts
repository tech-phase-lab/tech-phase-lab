import { etDay, isDay, knownThroughDay, mergeSplits, type SplitAnswer, type StockSplit } from "../research/stock-splits.ts";
import { SYMBOL, type DailyBar } from "./twelve-daily.ts";

/** RESOLUTE's shared Twelve Data copies (db/resolute/029_twelve_cache.sql), so a member count never multiplies provider calls:
 *  - resolute.twelve_daily_closes: the last few daily closes of a symbol for one U.S. market date, read once for everyone
 *    (the daily prefetch, services/resolute-api/twelve-prefetch.mjs, fills them before the first alert run).
 *  - resolute.twelve_splits: a symbol's provider split history and the ET day it was read (refreshed at most once a day by the
 *    prefetch). The alert job, 「今日やること」 and the settings API only read it.
 * Reads never throw: a missing table, a missing row or a damaged row is "not known", exactly as a failed provider read was before
 * (no close: nothing is judged; no splits: the manual list alone, with no `through`). */
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

const goodBars = (raw: unknown): DailyBar[] | null => {
  if (!Array.isArray(raw) || raw.length > 40) return null;
  const out: DailyBar[] = [];
  for (const item of raw) {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    if (!isDay(row.date) || typeof row.close !== "number" || !Number.isFinite(row.close) || row.close <= 0) return null;
    out.push({ date: row.date, close: row.close });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
};

export function createDailyCloseStore(db: Queryable) {
  return {
    /** The stored bars of each symbol for `marketDate` (a symbol stored as `[]` was answered "no such series"). Absent: not stored. */
    async read(symbols: readonly string[], marketDate: string): Promise<Map<string, DailyBar[]>> {
      const out = new Map<string, DailyBar[]>();
      const wanted = [...new Set(symbols)].filter(s => SYMBOL.test(s));
      if (!wanted.length || !isDay(marketDate)) return out;
      try {
        const rows = (await db.query("SELECT symbol, bars FROM resolute.twelve_daily_closes WHERE market_date = $1::date AND symbol = ANY($2::text[])", [marketDate, wanted])).rows;
        for (const row of rows) { const bars = goodBars(row.bars); if (typeof row.symbol === "string" && bars) out.set(row.symbol, bars); }
      } catch { /* no table yet, or unreadable: nothing is known */ }
      return out;
    },
    /** Stores answers (bars up to `marketDate` only). Returns how many rows were written; never throws. */
    async write(answers: Iterable<[string, DailyBar[]]>, marketDate: string): Promise<number> {
      let written = 0;
      for (const [symbol, bars] of answers) {
        if (!SYMBOL.test(symbol) || !isDay(marketDate)) continue;
        const kept = bars.filter(b => b.date <= marketDate).slice(-5);
        try {
          await db.query(`INSERT INTO resolute.twelve_daily_closes(symbol, market_date, bars) VALUES($1, $2::date, $3::jsonb)
            ON CONFLICT (symbol, market_date) DO UPDATE SET bars = EXCLUDED.bars, read_at = now()`, [symbol, marketDate, JSON.stringify(kept)]);
          written++;
        } catch { /* not stored: asked again next run */ }
      }
      return written;
    },
  };
}
export type DailyCloseStore = ReturnType<typeof createDailyCloseStore>;

const goodSplits = (raw: unknown, ticker: string): StockSplit[] | null => {
  if (!Array.isArray(raw) || raw.length > 200) return null;
  const out: StockSplit[] = [];
  for (const item of raw) {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    if (!isDay(row.date) || typeof row.ratio !== "number" || !Number.isFinite(row.ratio) || row.ratio <= 0) return null;
    out.push({ ticker, date: row.date, ratio: row.ratio });
  }
  return out;
};

/** The split loader every RESOLUTE reader uses (same answer as lib/research/stock-splits.ts createSplitLoader, from the shared copy):
 * a stored provider list with the manual list laid over it and `through` = the day before the ET day it was read. A ticker with no
 * stored row (not prefetched yet, or the table is not applied yet) is read by `fallback` (the leased provider loader: a split missing from
 * the manual list, SNDK 8-for-1 before it was listed, must never be judged unadjusted); without one, or when it fails, the manual list
 * alone and no `through`. */
export function createCachedSplitLoader(db: Queryable, fallback?: (tickers: readonly string[]) => Promise<SplitAnswer>) {
  return async function load(tickers: readonly string[]): Promise<SplitAnswer> {
    const unique = [...new Set(tickers)];
    const splits: Record<string, StockSplit[]> = {}, through: Record<string, string> = {};
    let rows: Record<string, unknown>[] = [];
    const wanted = unique.filter(t => SYMBOL.test(t));
    if (wanted.length) {
      try { rows = (await db.query("SELECT symbol, splits, read_at FROM resolute.twelve_splits WHERE symbol = ANY($1::text[])", [wanted])).rows; } catch { rows = []; }
    }
    const stored = new Map<string, { splits: StockSplit[]; at: number }>();
    for (const row of rows) {
      const at = row.read_at instanceof Date ? row.read_at.getTime() : Date.parse(String(row.read_at));
      const list = typeof row.symbol === "string" ? goodSplits(row.splits, row.symbol) : null;
      if (list && Number.isFinite(at)) stored.set(row.symbol as string, { splits: list, at });
    }
    const missing = unique.filter(t => !stored.has(t));
    let read: SplitAnswer | null = null;
    if (missing.length && fallback) { try { read = await fallback(missing); } catch { read = null; } }
    for (const ticker of unique) {
      const hit = stored.get(ticker);
      if (hit) { splits[ticker] = mergeSplits(ticker, hit.splits); through[ticker] = knownThroughDay(hit.at); continue; }
      splits[ticker] = read?.splits[ticker] ?? mergeSplits(ticker, []);
      if (read?.through[ticker]) through[ticker] = read.through[ticker];
    }
    return { splits, through };
  };
}

/** The tickers whose split list should be read again: never read first, then the oldest; none read on `today` (ET). */
export async function splitsDue(db: Queryable, tickers: readonly string[], today: string): Promise<string[]> {
  const wanted = [...new Set(tickers)].filter(t => SYMBOL.test(t));
  if (!wanted.length) return [];
  const rows = (await db.query("SELECT symbol, read_day::text AS read_day FROM resolute.twelve_splits WHERE symbol = ANY($1::text[])", [wanted])).rows;
  const day = new Map(rows.map(r => [String(r.symbol), String(r.read_day)]));
  return wanted.filter(t => (day.get(t) ?? "") < today).sort((a, b) => (day.get(a) ?? "").localeCompare(day.get(b) ?? "") || a.localeCompare(b));
}
export async function writeSplits(db: Queryable, ticker: string, provider: readonly StockSplit[], at: number): Promise<void> {
  const rows = provider.filter(s => s.ticker === ticker).map(s => ({ date: s.date, ratio: s.ratio }));
  await db.query(`INSERT INTO resolute.twelve_splits(symbol, splits, read_at, read_day) VALUES($1, $2::jsonb, $3, $4::date)
    ON CONFLICT (symbol) DO UPDATE SET splits = EXCLUDED.splits, read_at = EXCLUDED.read_at, read_day = EXCLUDED.read_day`,
  [ticker, JSON.stringify(rows), new Date(at).toISOString(), etDay(at)]);
}
