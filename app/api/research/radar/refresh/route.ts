import { validSyncToken } from "@/lib/membership/sync-auth";
import { loadRadarFactsFresh } from "@/lib/research/radar-server";
import { saveRow, storeConfig } from "@/lib/research/radar-store";
import { parseCursor, refreshChunk } from "@/lib/research/radar-refresh";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

/** The Financial Radar's daily refresh (lib/research/radar-refresh.ts): calculates every company of every genre again from the SEC and
 * saves it, without waiting for a visitor. Called twice a day by the Railway monitor (scripts/research/radar_refresh.py) with
 * `Authorization: Bearer <COMPARISON_WARM_SECRET or CRON_SECRET>`, the same secret as the comparison's warm job. One call does about
 * thirty seconds of work and answers `next`; the caller sends `?cursor=<next>` until `done`. A failed calculation is never saved.
 * The answer carries genres, tickers and counts only, never data or keys. */
async function handle(request: Request) {
  const auth = request.headers.get("authorization");
  if (!validSyncToken(auth, process.env.COMPARISON_WARM_SECRET) && !validSyncToken(auth, process.env.CRON_SECRET)) return Response.json({ ok: false }, { status: 401, headers });
  const cursor = parseCursor(new URL(request.url).searchParams.get("cursor"));
  if (cursor === null) return Response.json({ ok: false, error: "bad-cursor" }, { status: 400, headers });
  const config = storeConfig();
  // Without the storage the radar is calculated on each visit (half-hour cache), so there is nothing to keep fresh.
  if (!config) return Response.json({ ok: true, storage: false, done: true, next: null, refreshed: 0, live: 0, failed: 0, failures: [] }, { headers });
  try {
    const report = await refreshChunk(cursor, { load: loadRadarFactsFresh, save: row => saveRow(row, config) });
    console.info(`radar refresh ${report.from}-${report.next ?? report.total}/${report.total} refreshed=${report.refreshed} live=${report.live} failed=${report.failures.join(",") || "-"} stale=${report.stale.join(",") || "-"}`);
    return Response.json({ ok: true, storage: true, ...report }, { headers });
  } catch (error) {
    console.warn(`radar refresh failed: ${error instanceof Error ? error.message : "error"}`);
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
export const GET = handle;
export const POST = handle;
