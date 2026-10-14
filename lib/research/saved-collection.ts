// The legacy array is append-only on save, so its order already records save order.
export function parseSavedIds(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))] : [];
  } catch { return []; }
}
export function orderSavedEvents<T extends { id: string; publishedOn: string }>(events: T[], ids: string[], sort: "saved" | "published"): T[] {
  const positions = new Map(ids.map((id, index) => [id, index]));
  return [...events].sort((a, b) => sort === "saved"
    ? (positions.get(b.id) ?? -1) - (positions.get(a.id) ?? -1)
    : b.publishedOn.localeCompare(a.publishedOn) || (positions.get(b.id) ?? -1) - (positions.get(a.id) ?? -1));
}
