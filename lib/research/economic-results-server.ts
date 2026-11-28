import "server-only";
import { parseArchive } from "./economic-results-archive";
import { readMonitor } from "./tech-news-server";

/** Every stored economic indicator result from the monitor (GET /economic-results, same token as /news). An unreachable monitor
 * answers no rows: the live feed and the hand-kept rows still show. */
export async function loadEconomicResults(timeoutMs = 8_000) {
  try {
    const body = await readMonitor("economic-results", 2_000_000, timeoutMs) as { eventResults?: unknown };
    return { eventResults: parseArchive(body.eventResults), complete: true };
  } catch {
    return { eventResults: [], complete: false };
  }
}
