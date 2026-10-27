import { getMembership } from "@/lib/membership/server";
import { comparisonAccess } from "@/lib/research/comparison";
import { after } from "next/server";
import { buildRadar, radarGenre } from "@/lib/research/radar";
import { loadGenreEntries, warmGenres } from "@/lib/research/radar-server";
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
    const entries = await loadGenreEntries(genre.id);
    after(() => warmGenres(genre.id));
    // The entitlement may expire while upstream data is being fetched.
    const finalTier = tier === "pro" && comparisonAccess(member) === 200 ? "pro" : "free";
    return Response.json({ ok: true, radar: buildRadar(genre.id, entries, finalTier) }, { headers });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers }); }
}
