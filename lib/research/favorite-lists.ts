import { parseFavoriteStocks } from "./favorites.ts";

export const favoriteListsKey = "tech-phase:favorite-lists:v1";
export type FavoriteList = { id: string; name: string; tickers: string[] };
export type FavoriteLists = { lists: FavoriteList[]; names: Record<string, string> };
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
    return { lists, names };
  } catch { return { lists: [fallback], names: {} }; }
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
  delayed: boolean; source: "twelve-data";
};
export function usableFavoriteQuote(quote: FavoriteQuote | undefined, ticker: string): quote is FavoriteQuote {
  return !!quote && quote.source === "twelve-data" && quote.ticker === ticker &&
    Number.isFinite(quote.price) && quote.price > 0 && Number.isFinite(Date.parse(quote.asOf)) &&
    (quote.change === null || Number.isFinite(quote.change)) &&
    (quote.percentChange === null || Number.isFinite(quote.percentChange));
}
