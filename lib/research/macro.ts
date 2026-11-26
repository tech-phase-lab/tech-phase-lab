/** 原油・米国債 (マーケット): the last two daily FRED observations of each series. The FRED reads are kept by the data cache for six hours, so the
 * API (app/api/research/macro) and the page's first paint (app/research/market/page.tsx) share one copy. */
export const MACRO_SERIES = ["DCOILWTICO", "DGS10", "DGS30"] as const;
export type MacroQuote = { id: string; date?: string; value?: number; previous?: number; previousDate?: string; unavailable?: boolean };

export async function loadMacro(now = Date.now()): Promise<MacroQuote[]> {
  const start = new Date(now - 45 * 86400000).toISOString().slice(0, 10);
  return Promise.all(MACRO_SERIES.map(async id => {
    try {
      const response = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start}`, {
        next: { revalidate: 21600 }, signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Source unavailable");
      const rows = (await response.text()).trim().split(/\r?\n/).slice(1)
        .map(line => line.split(","))
        .filter(([date, value]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && value?.trim() && Number.isFinite(Number(value)))
        .map(([date, value]) => ({ date, value: Number(value) }))
        .sort((a, b) => a.date.localeCompare(b.date));
      const latest = rows.at(-1);
      const previous = rows.at(-2);
      if (!latest || !previous) throw new Error("No observations");
      return { id, ...latest, previous: previous.value, previousDate: previous.date };
    } catch {
      return { id, unavailable: true };
    }
  }));
}
