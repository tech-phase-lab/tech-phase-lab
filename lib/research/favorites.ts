export const favoriteStocksKey = "tech-phase:favorite-stocks:v1";

export function parseFavoriteStocks(raw: string | null): string[] {
  if (!raw || raw.length > 10000) return [];
  try {
    const values: unknown = JSON.parse(raw);
    return Array.isArray(values) ? [...new Set(values.filter((value): value is string => typeof value === "string" && /^[A-Z][A-Z0-9.-]{0,14}$/.test(value)))].slice(0, 100) : [];
  } catch { return []; }
}

export function toggleFavoriteStock(current: string[], ticker: string): string[] {
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker)) return current;
  return current.includes(ticker) ? current.filter((item) => item !== ticker) : [...current, ticker].slice(0, 100);
}

// Keep macro releases visible when narrowing the calendar to followed companies.
export function filterFavoriteEvents<T extends { kind: "earnings" | "economic"; ticker?: string }>(events: T[], favorites: string[], includeEconomic = true): T[] {
  const tickers = new Set(favorites);
  return events.filter((event) => event.kind === "economic" ? includeEconomic : !!event.ticker && tickers.has(event.ticker));
}
