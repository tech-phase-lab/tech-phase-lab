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
