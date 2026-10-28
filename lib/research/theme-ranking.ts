import { THEMES, type ThemeDefinition } from "./theme-definitions.ts";

export type Period = "1d" | "1w" | "1m" | "3m";
export const PERIODS: readonly Period[] = ["1d", "1w", "1m", "3m"];
/** Trading-day look-backs: yesterday, one week, one month, three months. */
export const PERIOD_DAYS: Record<Period, number> = { "1d": 1, "1w": 5, "1m": 21, "3m": 63 };

/** One stock's daily closes, newest first, as the price source returns them. */
export type CloseSeries = { ticker: string; closes: number[]; asOf: string };
export type StockReturns = { ticker: string; returns: Partial<Record<Period, number>> };

/** Percent change from the close `days` trading days back to the latest close; null when the history is too short. */
export function periodReturn(closes: readonly number[], days: number): number | null {
  if (closes.length <= days) return null;
  const latest = closes[0], base = closes[days];
  return Number.isFinite(latest) && Number.isFinite(base) && base > 0 ? (latest / base - 1) * 100 : null;
}

export function stockReturns(series: CloseSeries): StockReturns {
  const returns: Partial<Record<Period, number>> = {};
  for (const period of PERIODS) { const value = periodReturn(series.closes, PERIOD_DAYS[period]); if (value !== null) returns[period] = value; }
  return { ticker: series.ticker, returns };
}

export type ThemeRow = {
  id: string; ja: string; en: string; rank: number; value: number; covered: number; total: number;
  leader: { ticker: string; value: number }; laggard: { ticker: string; value: number };
  members: { ticker: string; value: number | null }[];
};
/** A theme needs at least two members with a number before it is ranked at all. */
export const MIN_COVERED = 2;

export function rankThemes(stocks: readonly StockReturns[], period: Period, themes: readonly ThemeDefinition[] = THEMES): ThemeRow[] {
  const byTicker = new Map(stocks.map(stock => [stock.ticker, stock]));
  const rows = themes.flatMap(theme => {
    const members = theme.tickers.map(ticker => ({ ticker, value: byTicker.get(ticker)?.returns[period] ?? null }));
    const priced = members.filter((member): member is { ticker: string; value: number } => member.value !== null);
    if (priced.length < MIN_COVERED) return [];
    const sorted = [...priced].sort((a, b) => b.value - a.value);
    return [{ id: theme.id, ja: theme.ja, en: theme.en, rank: 0, value: priced.reduce((sum, member) => sum + member.value, 0) / priced.length,
      covered: priced.length, total: theme.tickers.length, leader: sorted[0], laggard: sorted.at(-1)!,
      members: [...members].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity)) }];
  });
  return rows.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)).map((row, index) => ({ ...row, rank: index + 1 }));
}

/** Same rule as the other PRO tools: signed in, PRO, and the access window still open. */
export function themeRankingAccess(member: { status: string; plan: string; accessExpiresAt?: number }, now = Date.now()): 200 | 401 | 403 | 503 {
  if (member.status === "unavailable") return 503;
  if (member.status !== "signed-in") return 401;
  return member.plan === "pro" && Number.isFinite(member.accessExpiresAt) && member.accessExpiresAt! > now ? 200 : 403;
}

/** Owner-only look at the finished screen before the price feed is connected. Plainly labelled as a sample on screen;
 * never served by an API and never shown to members. Deterministic so the preview does not shuffle on every visit. */
export function sampleStockReturns(tickers: readonly string[]): StockReturns[] {
  let seed = 20261025;
  const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  return tickers.map(ticker => ({ ticker, returns: { "1d": (next() - 0.45) * 6, "1w": (next() - 0.4) * 14, "1m": (next() - 0.35) * 30, "3m": (next() - 0.3) * 55 } }));
}
