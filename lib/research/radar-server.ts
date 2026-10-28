import "server-only";
import { unstable_cache } from "next/cache";
import { radarFacts, type RadarFacts } from "./radar-facts";
import { secCik, secText } from "./comparison-server";
import { REVIEW_ABOVE, radarGenre, radarGenres, type RadarGenreId } from "./radar";
import { factsFromRow, isStale, readRows, saveRow, storeConfig, toRow } from "./radar-store";

// Read again every half hour, so a new earnings report or filing shows up on its own; the previous earnings
// come from the same filing history, so there is nothing separate to store.
const read = unstable_cache(async (cik: string): Promise<RadarFacts> =>
  radarFacts(JSON.parse(await secText(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`, 25_000_000))),
["radar-facts-v1"], { revalidate: 1800 });

export async function loadRadarFacts(ticker: string): Promise<RadarFacts> {
  try {
    const cik = await secCik(ticker);
    return cik ? await read(cik) : { latest: null, previous: null, reason: "unsupported" };
  } catch { return { latest: null, previous: null, reason: "unavailable" }; }
}

/** Every company of a genre. With the storage API set up, the stored values are read (no SEC request, no calculation);
 * a company that has no stored value yet, or a storage that cannot be read, falls back to the live calculation. */
export async function loadGenreEntries(genre: RadarGenreId) {
  const tickers = radarGenre(genre)?.tickers ?? [];
  const rows = await readRows(genre);
  return Promise.all(tickers.map(async ticker => {
    const row = rows?.get(ticker);
    return { ticker, facts: row ? factsFromRow(row) : await loadRadarFacts(ticker) };
  }));
}

const lastCheck = new Map<string, number>();
/** After the response has gone: calculate again what is missing or older than six hours and save it. A calculation that fails is
 * not saved, so the last good value stays. Checked at most every ten minutes per genre in one server. */
export async function refreshStored(genre: RadarGenreId) {
  const config = storeConfig();
  const now = Date.now();
  if (!config || now - (lastCheck.get(genre) ?? 0) < 600_000) return;
  lastCheck.set(genre, now);
  const rows = await readRows(genre, config);
  if (!rows) return; // storage unreachable: nothing to compare with, so nothing is written
  for (const ticker of radarGenre(genre)?.tickers ?? []) {
    if (!isStale(rows.get(ticker), now)) continue;
    try {
      const row = toRow(genre, ticker, await loadRadarFacts(ticker), now, REVIEW_ABOVE);
      if (row) await saveRow(row, config);
    } catch { /* the stored value stays until the next visit */ }
  }
}

/** What to do once a radar response has gone: keep the storage fresh, or (without storage) fill the cache for the other genres. */
export async function afterRadar(genre: RadarGenreId) {
  if (storeConfig()) { try { await refreshStored(genre); } catch { /* the next visit asks again */ } return; }
  await warmGenres(genre);
}

/** Fills the cache for the other genres once the response has gone, so that switching tabs is instant. */
export async function warmGenres(except: RadarGenreId) {
  for (const genre of radarGenres) if (genre.id !== except) { try { await loadGenreEntries(genre.id); } catch { /* the next visit asks again */ } }
}
