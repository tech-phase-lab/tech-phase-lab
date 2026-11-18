import "server-only";
import { unstable_cache } from "next/cache";
import { radarFacts, type CompanyFacts, type RadarFacts } from "./radar-facts";
import { supplementFacts } from "./radar-filings";
import { secCik, secText } from "./comparison-server";
import { REVIEW_ABOVE, formerGenres, radarGenre, radarGenres, type RadarGenreId } from "./radar";
import { factsFromRow, isStale, readRows, saveRow, storeConfig, toRow } from "./radar-store";

/** SEC archive requests one after another, a little apart (the SEC's fair-access limit is ten a second for everything). */
const spacedSecText = () => {
  let last = 0;
  return async (url: string, limit: number) => {
    const wait = last + 150 - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    last = Date.now();
    return secText(url, limit);
  };
};
/** Company facts, plus what the SEC's archive holds beyond them (radar-filings.ts): a foreign filer's 6-K quarter, a 10-Q the company
 * facts have not taken in yet. `filing` (the newest filed period) lets the radar say when it is behind. */
const readNow = async (cik: string): Promise<RadarFacts> => {
  const padded = cik.padStart(10, "0");
  const facts = JSON.parse(await secText(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`, 25_000_000)) as CompanyFacts;
  let submissions: unknown = null;
  try { submissions = JSON.parse(await secText(`https://data.sec.gov/submissions/CIK${padded}.json`, 5_000_000)); } catch { /* the company facts alone, as before */ }
  if (!submissions) return radarFacts(facts);
  const more = await supplementFacts(cik, facts, submissions, spacedSecText());
  return { ...radarFacts(more.facts), filing: more.filing, unread: more.unread };
};
// Read again every half hour, so a new earnings report or filing shows up on its own; the previous earnings
// come from the same filing history, so there is nothing separate to store. v2: with the archive's filings (Nov 18).
const read = unstable_cache(readNow, ["radar-facts-v2-filings"], { revalidate: 1800 });

/** The daily refresh (app/api/research/radar/refresh): straight from the SEC, never the half-hour cache, so a filing of the last
 * half hour is included. Throws when the SEC cannot be read (the caller then keeps the stored value). */
export async function loadRadarFactsFresh(ticker: string): Promise<RadarFacts> {
  const cik = await secCik(ticker);
  return cik ? readNow(cik) : { latest: null, previous: null, reason: "unsupported" };
}

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
  // Only the genre's own companies are read: a stored row of a company that has left the genre is never looked at.
  // A company that has just joined is taken from its former genre's rows until it has its own.
  const former = new Map<string, Awaited<ReturnType<typeof readRows>>>();
  const formerRow = async (ticker: string) => {
    for (const id of formerGenres[ticker] ?? []) {
      if (id === genre) continue;
      if (!former.has(id)) former.set(id, await readRows(id));
      const row = former.get(id)?.get(ticker);
      if (row) return row;
    }
    return undefined;
  };
  return Promise.all(tickers.map(async ticker => {
    const row = rows?.get(ticker) ?? (rows ? await formerRow(ticker) : undefined);
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
