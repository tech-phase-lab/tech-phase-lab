import { parseFavoriteStocks } from "./favorites.ts";

export const favoriteListsKey = "tech-phase:favorite-lists:v1";
export type FavoriteList = { id: string; name: string; tickers: string[] };
export type FavoriteLists = { lists: FavoriteList[]; names: Record<string, string>; alerts?: PriceAlert[] };
export function parseFavoriteLists(raw: string | null, legacy: string | null): FavoriteLists {
  const fallback: FavoriteList = { id: "default", name: "", tickers: parseFavoriteStocks(legacy) };
  try {
    if (!raw || raw.length > 200000) return { lists: [fallback], names: {} };
    const value = JSON.parse(raw);
    const seen = new Set(["default"]);
    const lists: FavoriteList[] = [fallback];
    for (const item of Array.isArray(value.lists) ? value.lists : []) {
      if (typeof item?.name !== "string" || typeof item?.id !== "string") continue;
      if (item.id === "default") { fallback.name = item.name.trim().slice(0, 40); continue; }
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || seen.has(item.id)) continue;
      seen.add(item.id);
      lists.push({ id: item.id, name: item.name.trim().slice(0, 40), tickers: parseFavoriteStocks(JSON.stringify(item.tickers)) });
      if (lists.length === 20) break;
    }
    const names: Record<string, string> = {};
    for (const [ticker, name] of Object.entries(value.names ?? {})) {
      if (/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker) && typeof name === "string") names[ticker] = name.slice(0, 160);
    }
    return { lists, names, alerts: parsePriceAlerts(value.alerts) };
  } catch { return { lists: [fallback], names: {} }; }
}
// Empty slots are presented without saving or replacing existing lists.
export function watchlistSlots(lists: FavoriteList[]): FavoriteList[] {
  const result = [...lists];
  for (let slot = result.length + 1; result.length < 7; slot++) {
    let id = `my-list-${slot}`;
    while (result.some(item => item.id === id)) id += "-empty";
    result.push({ id, name: "", tickers: [] });
  }
  return result;
}
export function moveFavorite(tickers: string[], ticker: string, delta: number) {
  const index = tickers.indexOf(ticker), next = index + delta;
  if (index < 0 || next < 0 || next >= tickers.length) return tickers;
  const result = [...tickers];
  [result[index], result[next]] = [result[next], result[index]];
  return result;
}

// Presentation contract for the licensed Twelve Data collector. Prices are never
// inferred from charts. Session, source timestamp and delay travel with each quote.
export type FavoriteQuote = {
  ticker: string; price: number; change: number | null; percentChange: number | null;
  currency: string; asOf: string; session: "regular" | "pre" | "post" | "closed";
  history?: { at: string; price: number }[];
  extended?: { price: number; percentChange: number; asOf: string; session: "pre" | "post" };
  delayed: boolean; source: "twelve-data";
};
export function usableFavoriteQuote(quote: FavoriteQuote | undefined, ticker: string): quote is FavoriteQuote {
  return !!quote && quote.source === "twelve-data" && quote.ticker === ticker &&
    Number.isFinite(quote.price) && quote.price > 0 && Number.isFinite(Date.parse(quote.asOf)) &&
    (quote.change === null || Number.isFinite(quote.change)) &&
    (quote.percentChange === null || Number.isFinite(quote.percentChange));
}

export type PriceAlert = { ticker: string; price: number; direction: "above" | "below"; currency: string };
export function parsePriceAlerts(value: unknown): PriceAlert[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((item): item is PriceAlert => {
    if (!item || typeof item.ticker !== "string" || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(item.ticker) || !Number.isFinite(item.price) || item.price <= 0 || item.price > 1e9 || !["above", "below"].includes(item.direction) || !/^[A-Z]{3}$/.test(item.currency)) return false;
    const key = `${item.ticker}:${item.direction}`; if (seen.has(key)) return false; seen.add(key); return true;
  }).slice(0, 100);
}
export function sortFavorites(tickers: string[], quotes: Record<string, FavoriteQuote>, order: string) {
  if (order === "ticker") return [...tickers].sort();
  if (!["gainers", "losers"].includes(order)) return tickers;
  return [...tickers].sort((a, b) => {
    const av = usableFavoriteQuote(quotes[a], a) ? quotes[a].percentChange : null;
    const bv = usableFavoriteQuote(quotes[b], b) ? quotes[b].percentChange : null;
    if (av == null) return bv == null ? 0 : 1;
    if (bv == null) return -1;
    return order === "gainers" ? bv - av : av - bv;
  });
}
export function sparklinePoints(history: FavoriteQuote["history"]) {
  if (!history || history.length < 2 || history.some(p => !Number.isFinite(p.price) || p.price <= 0 || !Number.isFinite(Date.parse(p.at)))) return "";
  const points = history.slice(-120);
  if (points.some((p, i) => i > 0 && Date.parse(p.at) <= Date.parse(points[i - 1].at))) return "";
  const low = Math.min(...points.map(p => p.price)), high = Math.max(...points.map(p => p.price));
  return points.map((p, i) => `${(i * 96 / (points.length - 1) + 2).toFixed(2)},${(high === low ? 20 : 36 - (p.price - low) / (high - low) * 32).toFixed(2)}`).join(" ");
}
