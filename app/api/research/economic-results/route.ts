import { loadEconomicResults } from "@/lib/research/economic-results-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** Every stored economic indicator result for the calendar's 「経済指標の結果」 (Nov 28): not only the news feed's newest 20 and its
 * seven days of BLS/BEA headlines. The calendar and its results are FREE (policy of Oct 25), so this answer is the same for everyone. */
export async function GET() {
  const { eventResults, complete } = await loadEconomicResults();
  return Response.json({ ok: true, eventResults, complete }, {
    headers: { "Cache-Control": complete ? "public, max-age=0, s-maxage=120, stale-while-revalidate=600" : "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
