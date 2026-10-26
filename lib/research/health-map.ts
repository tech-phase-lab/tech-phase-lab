import type { Financials } from "./comparison.ts";

/** Genres the financial-health map can show. Tickers are listed in the order they are drawn. */
export const healthGenres = [
  { id: "ai-cloud", ja: "AIクラウド", en: "AI cloud", tickers: ["CRWV", "NBIS", "IREN", "APLD", "CIFR", "WULF", "CORZ"] },
  { id: "semis", ja: "半導体", en: "Semiconductors", tickers: ["NVDA", "AMD", "AVGO", "MU", "QCOM", "INTC", "MRVL"] },
  { id: "network", ja: "通信・光", en: "Networking and optical", tickers: ["ANET", "LITE", "COHR", "CRDO", "ALAB", "AAOI"] },
  { id: "software", ja: "ソフトウェア", en: "Software", tickers: ["MSFT", "ORCL", "NOW", "CRM", "ADBE", "PLTR", "SNOW"] },
  { id: "power", ja: "電力・設備", en: "Power and equipment", tickers: ["VST", "CEG", "GEV", "BE", "VRT"] },
] as const;
export type HealthGenreId = typeof healthGenres[number]["id"];
export const healthGenre = (id: string | null) => healthGenres.find(genre => genre.id === id);

export const FCF_MIN = -100, FCF_MAX = 50;
export const COVER_MIN = 0.1, COVER_MAX = 10;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export type HealthPoint = {
  ticker: string;
  /** Free cash flow as a percentage of revenue (x axis). */
  fcfMargin: number | null;
  /** Cash divided by borrowings and leases (y axis); null when the balance sheet does not show them. */
  cover: number | null;
  revenueGrowth: number | null;
  asOf: string | null;
  sourceUrl: string | null;
};

/** Cash on hand against everything owed to lenders and lessors. A missing debt tag is
 * not proof of a debt-free company, so a ratio is only given when at least one is present. */
export function healthPoint(f: Financials): HealthPoint {
  const balance = f.balance;
  const cash = balance?.cash?.value ?? f.cash?.value ?? null;
  const owed = balance ? [balance.debtCurrent, balance.debtNoncurrent, balance.shortBorrowings, balance.leaseCurrent, balance.leaseNoncurrent].flatMap(fact => fact ? [fact.value] : []) : [];
  const total = owed.reduce((sum, value) => sum + value, 0);
  const cover = f.status !== "ready" || cash === null || cash < 0 || !owed.length ? null : total > 0 ? cash / total : COVER_MAX;
  return {
    ticker: f.ticker,
    fcfMargin: f.status === "ready" && f.fcfMargin !== null && Number.isFinite(f.fcfMargin) ? f.fcfMargin : null,
    cover: cover !== null && Number.isFinite(cover) ? cover : null,
    revenueGrowth: f.status === "ready" ? f.revenueGrowth : null,
    asOf: balance?.end ?? null,
    sourceUrl: balance?.sourceUrl ?? f.sourceUrl,
  };
}

/** Position inside the chart, 0 to 1 from the left / bottom. Values beyond the range sit on the edge. */
export const xPosition = (fcfMargin: number) => (clamp(fcfMargin, FCF_MIN, FCF_MAX) - FCF_MIN) / (FCF_MAX - FCF_MIN);
export const yPosition = (cover: number) => (Math.log10(clamp(cover, COVER_MIN, COVER_MAX)) - Math.log10(COVER_MIN)) / (Math.log10(COVER_MAX) - Math.log10(COVER_MIN));
export const isClamped = (point: HealthPoint) => (point.fcfMargin !== null && (point.fcfMargin < FCF_MIN || point.fcfMargin > FCF_MAX)) || (point.cover !== null && (point.cover < COVER_MIN || point.cover > COVER_MAX));

export type Quadrant = "strong" | "cushion" | "earning" | "watch";
/** Cash flow is positive above zero; cash covers what is owed at 1.0 or more. */
export function quadrant(point: HealthPoint): Quadrant | null {
  if (point.fcfMargin === null || point.cover === null) return null;
  const earns = point.fcfMargin >= 0, covered = point.cover >= 1;
  return earns && covered ? "strong" : covered ? "cushion" : earns ? "earning" : "watch";
}
