import "server-only";
import { FRED_SERIES, fromObservations, readFredCsv, type Backfill } from "./economic-history";

/** The earlier releases of each indicator from FRED, read the way the market page reads oil and Treasury yields (lib/research/macro.ts):
 * fredgraph.csv without a key, kept by the data cache for six hours. A series that cannot be read is left out (its bars then come from
 * the stored results only). */
export async function loadEconomicBackfill(now = Date.now()): Promise<Backfill> {
  // two years: six quarters of GDP and the month before the oldest monthly change
  const start = new Date(now - 730 * 86_400_000).toISOString().slice(0, 10);
  const entries = await Promise.all(Object.entries(FRED_SERIES).map(async ([key, spec]) => {
    try {
      const response = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${spec.id}&cosd=${start}`, {
        next: { revalidate: 21600 }, signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Source unavailable");
      return [key, fromObservations(key, readFredCsv(await response.text())).slice(-14)] as const;
    } catch {
      return null;
    }
  }));
  return Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry[1].length > 0));
}
