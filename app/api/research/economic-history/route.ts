import { loadEconomicBackfill } from "@/lib/research/economic-history-server";

/** Earlier releases of the economic indicators from FRED (owner, Nov 28), for the calendar's opened rows. FREE and the same for every
 * visitor; FRED is read at most every six hours. */
export async function GET() {
  const series = await loadEconomicBackfill();
  return Response.json({ ok: true, series }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400" } });
}
