import type { StockReturns } from "./theme-ranking.ts";

/** 銘柄手帳 weekly moves: every stock on the list, ranked by its one-week price change, news or no news. */
export type WeekMover = { ticker: string; change: number };
export type WeekSummary = { up: number; down: number; flat: number; covered: number; missing: number; ranked: WeekMover[] };

export function weekSummary(stocks: readonly StockReturns[], tickers: readonly string[]): WeekSummary {
  const wanted = new Set(tickers);
  const ranked: WeekMover[] = [];
  for (const stock of stocks) {
    const change = stock.returns["1w"];
    if (wanted.has(stock.ticker) && typeof change === "number" && Number.isFinite(change)) ranked.push({ ticker: stock.ticker, change });
  }
  ranked.sort((a, b) => b.change - a.change);
  const up = ranked.filter(item => item.change > 0.005).length, down = ranked.filter(item => item.change < -0.005).length;
  return { up, down, flat: ranked.length - up - down, covered: ranked.length, missing: wanted.size - ranked.length, ranked };
}

export const TICKER_PATTERN = /^[A-Z][A-Z0-9.-]{0,14}$/;
export const WEEK_TICKER_LIMIT = 100;
/** The query list is cleaned the same way on the server and in tests: valid, unique, sorted, capped. */
export function cleanTickers(raw: string | null): string[] {
  return [...new Set((raw ?? "").split(",").map(item => item.trim().toUpperCase()).filter(item => TICKER_PATTERN.test(item)))].sort().slice(0, WEEK_TICKER_LIMIT);
}
export const signedPercent = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`;
