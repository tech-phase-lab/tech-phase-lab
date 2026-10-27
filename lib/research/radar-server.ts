import "server-only";
import { unstable_cache } from "next/cache";
import { radarFacts, type RadarFacts } from "./radar-facts";
import { secCik, secText } from "./comparison-server";

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
