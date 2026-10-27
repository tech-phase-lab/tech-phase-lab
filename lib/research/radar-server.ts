import "server-only";
import { unstable_cache } from "next/cache";
import { radarFacts, type RadarFacts } from "./radar-facts";
import { secCik, secText } from "./comparison-server";
import { radarGenre, radarGenres, type RadarGenreId } from "./radar";

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

/** Every company of a genre, read at once (one SEC request each, well under the ten-a-second limit). */
export async function loadGenreEntries(genre: RadarGenreId) {
  const tickers = radarGenre(genre)?.tickers ?? [];
  return Promise.all(tickers.map(async ticker => ({ ticker, facts: await loadRadarFacts(ticker) })));
}

/** Fills the cache for the other genres once the response has gone, so that switching tabs is instant. */
export async function warmGenres(except: RadarGenreId) {
  for (const genre of radarGenres) if (genre.id !== except) { try { await loadGenreEntries(genre.id); } catch { /* the next visit asks again */ } }
}
