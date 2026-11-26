/** The saved data of the PRO feature tour's samples (owner, Nov 16). The tour pages read only these committed files and never fetch
 * anything: real PRO data costs money to read and must not reach FREE visitors. scripts/pro-experience/build-samples.mjs writes them; each
 * file says where its numbers came from (_source). Pure: no network, no storage. */
import type { ComparisonResult } from "./comparison.ts";
import { applyValueCheck, type ValueFigure } from "./comparison-value.ts";
import type { Holding, Quote } from "../portfolio/calc.ts";
import compareFile from "./pro-experience-samples/compare.json" with { type: "json" };
import portfolioFile from "./pro-experience-samples/portfolio.json" with { type: "json" };

// ---- Stock Comparison: four stocks, any two of them (six pairs) ----
export const COMPARE_TICKERS = ["NVDA", "AMD", "INTC", "ARM"] as const;
type SampleCompany = ComparisonResult["companies"][number];
const compare = compareFile as unknown as { snapshotAt: string; companies: Record<string, SampleCompany> };
/** The time the comparison is judged at: the moment the figures were saved, so the sample never goes stale. */
export const compareNow = Date.parse(compare.snapshotAt);
export const comparePairs = (): [string, string][] => COMPARE_TICKERS.flatMap((a, i) => COMPARE_TICKERS.slice(i + 1).map(b => [a, b] as [string, string]));
/** One tap on a stock in the picker (owner, Nov 16), in the order chosen: ① is the older choice, ② the newer. A chosen stock is removed; with
 * fewer than two it is added; a third drops ①, so the old ② becomes ① and the tapped stock ②. Never refuses a tap. */
export function nextPicks(current: readonly string[], ticker: string): string[] {
  if (current.includes(ticker)) return current.filter(t => t !== ticker);
  return current.length >= 2 ? [current[current.length - 1], ticker] : [...current, ticker];
}
/** The result page's data for two of the four stocks; null for anything else (another stock, the same stock twice, more than two). */
export function compareSample(tickers: readonly string[]): ComparisonResult | null {
  if (tickers.length !== 2 || tickers[0] === tickers[1] || !tickers.every(t => (COMPARE_TICKERS as readonly string[]).includes(t))) return null;
  const saved = tickers.map(t => compare.companies[t]);
  if (saved.some(c => !c)) return null;
  // Valuation as on Treasure Hunt (owner, Nov 26): each sample company's fictional figure against its own five-year average.
  const values = Object.fromEntries(saved.map(c => [c.ticker, c.valueCheck as ValueFigure]));
  const companies = applyValueCheck(saved, { values });
  return { companies, comparable: true, reasons: [], generatedAt: compare.snapshotAt, conclusion: { ja: "", en: "" } };
}

// ---- US stock portfolio: the holdings in sample-holdings.jpg ----
type SampleHolding = Holding & { name: string; price: number; avgCostFx: number; gainJpy: number };
const portfolio = portfolioFile as { image: string; asOf: string; usdJpy: number; totalGainUsd: number; totalGainJpy: number; holdings: SampleHolding[] };
export const PORTFOLIO_IMAGE = portfolio.image;
export const PORTFOLIO_TOTAL_GAIN = portfolio.totalGainUsd;
/** The image's yen total (+484,710円); the made-up exchange rates in the file are chosen so the holdings add up to it. */
export const PORTFOLIO_TOTAL_GAIN_JPY = portfolio.totalGainJpy;
/** Each holding's yen gain as saved in the file (whole yen), for checking the made-up rates. */
export const portfolioGainJpy: Record<string, number> = Object.fromEntries(portfolio.holdings.map(h => [h.ticker, h.gainJpy]));
export const portfolioHoldings: Holding[] = portfolio.holdings.map(({ ticker, name, shares, avgCostUsd, avgCostFx }) => ({ ticker, name, shares, avgCostUsd, avgCostFx }));
export const portfolioMarket: { quotes: Record<string, Quote>; usdJpy: number | null; asOf: string } = {
  quotes: Object.fromEntries(portfolio.holdings.map(h => [h.ticker, { ticker: h.ticker, close: h.price, asOf: portfolio.asOf }])),
  usdJpy: portfolio.usdJpy, asOf: portfolio.asOf,
};
/** How long the reading animation runs before the holdings appear (owner: "2秒ほど"): the first step, then the second. */
export const READING_STEPS_MS = [700, 1300] as const;
