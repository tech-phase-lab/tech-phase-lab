export const stockHistoryKey = "tech-phase:stock-history:v1";
const validTicker = /^[A-Z][A-Z0-9.-]{0,14}$/;

export function parseStockHistory(raw: string | null): string[] {
  if (!raw || raw.length > 10000) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && validTicker.test(item)))].slice(0, 8) : [];
  } catch { return []; }
}

export function rememberStock(history: string[], ticker: string): string[] {
  return validTicker.test(ticker) ? [ticker, ...history.filter((item) => item !== ticker)].slice(0, 8) : history;
}
