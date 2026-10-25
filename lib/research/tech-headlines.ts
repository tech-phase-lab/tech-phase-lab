/** FREE projection: no summary, URL, source body or analysis fields. */
export type TechHeadline = {
  id: string; tickers: string[]; titleEn: string; titleJa?: string;
  at: string; timeKind: 'published' | 'date';
};
export function parseTechHeadlines(value: unknown): TechHeadline[] {
  if (!Array.isArray(value) || value.length > 5) return [];
  return value.flatMap(v => {
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || v.id.length > 180
      || !Array.isArray(v.tickers) || !v.tickers.length || v.tickers.length > 30
      || !v.tickers.every((t: unknown) => typeof t === 'string' && /^[A-Z][A-Z0-9.-]{0,9}$/.test(t))
      || typeof v.titleEn !== 'string' || !v.titleEn.trim() || v.titleEn.length > 2000
      || (v.titleJa !== undefined && (typeof v.titleJa !== 'string' || v.titleJa.length > 2000))
      || typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at))
      || !['published', 'date'].includes(v.timeKind)) return [];
    return [{ id: v.id, tickers: [...v.tickers], titleEn: v.titleEn,
      ...(v.titleJa ? { titleJa: v.titleJa } : {}), at: v.at, timeKind: v.timeKind }];
  });
}
