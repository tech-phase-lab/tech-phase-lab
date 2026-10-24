export function stockSearchUrl(query: string, selection?: string | null) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (selection) params.set("stock", selection);
  return `/research/stocks${params.size ? `?${params}` : ""}`;
}

export function stockSearchReturnPosition(state: unknown, query: string): number | null {
  if (!state || typeof state !== "object" || !("stockSearch" in state)) return null;
  const value = state.stockSearch;
  if (!value || typeof value !== "object" || !("query" in value) || !("y" in value)) return null;
  return value.query === query && typeof value.y === "number" && Number.isFinite(value.y) && value.y >= 0 ? value.y : null;
}
