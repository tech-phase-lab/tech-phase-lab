import { getMembership } from "@/lib/membership/server";
import { comparisonAccess } from "@/lib/research/comparison";
import { loadComparisonFinancials } from "@/lib/research/comparison-server";
import { healthGenre, healthPoint } from "@/lib/research/health-map";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
/** Financial-health points for one genre, read from SEC filings. Same access as the PRO comparison. */
export async function GET(request: Request) {
  try {
    const member = await getMembership();
    const access = comparisonAccess(member);
    if (access !== 200) return Response.json({ ok: false, error: access === 401 ? "sign-in" : access === 403 ? "pro-required" : "unavailable" }, { status: access, headers });
    const genre = healthGenre(new URL(request.url).searchParams.get("genre"));
    if (!genre) return Response.json({ ok: false, error: "unknown-genre" }, { status: 400, headers });
    // SEC asks for no more than ten requests a second, and each company takes about three: read three companies at a time.
    const points = [];
    for (let i = 0; i < genre.tickers.length; i += 3)
      points.push(...await Promise.all(genre.tickers.slice(i, i + 3).map(async ticker => healthPoint({ ...await loadComparisonFinancials(ticker), ticker }))));
    // The entitlement may expire while upstream data is being fetched.
    if (comparisonAccess(member) !== 200) return Response.json({ ok: false, error: "pro-required" }, { status: 403, headers });
    return Response.json({ ok: true, genre: genre.id, points, generatedAt: new Date().toISOString() }, { headers });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers }); }
}
