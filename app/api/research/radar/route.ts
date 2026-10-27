import { getMembership } from "@/lib/membership/server";
import { comparisonAccess } from "@/lib/research/comparison";
import { buildRadar, radarGenre } from "@/lib/research/radar";
import { loadRadarFacts } from "@/lib/research/radar-server";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
/** Financial Radar for one genre. Whether the caller is PRO is decided here: a FREE caller is sent the dots only,
 * never the previous earnings, the numbers or the ranking. */
export async function GET(request: Request) {
  try {
    const genre = radarGenre(new URL(request.url).searchParams.get("genre"));
    if (!genre) return Response.json({ ok: false, error: "unknown-genre" }, { status: 400, headers });
    const member = await getMembership();
    const tier = comparisonAccess(member) === 200 ? "pro" : "free";
    // SEC asks for no more than ten requests a second: read three companies at a time.
    const entries: { ticker: string; facts: Awaited<ReturnType<typeof loadRadarFacts>> }[] = [];
    for (let i = 0; i < genre.tickers.length; i += 3)
      entries.push(...await Promise.all(genre.tickers.slice(i, i + 3).map(async ticker => ({ ticker, facts: await loadRadarFacts(ticker) }))));
    // The entitlement may expire while upstream data is being fetched.
    const finalTier = tier === "pro" && comparisonAccess(member) === 200 ? "pro" : "free";
    return Response.json({ ok: true, radar: buildRadar(genre.id, entries, finalTier) }, { headers });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers }); }
}
