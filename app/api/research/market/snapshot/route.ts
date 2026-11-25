import { loadBoardSnapshot, marketDataConfigured } from "@/lib/research/market-data";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
/** マーケット: every tab's cards and each tab's first 15-minute chart at once (owner, Nov 25: a tab must show the moment it is opened), from the
 * shared snapshot the site's minute job refreshes (lib/research/market-data.ts refreshBoardSnapshot). A member's request never asks the provider
 * (except the very first fill of a new snapshot). The page draws from it at once and keeps asking for fresher copies as before. */
export async function GET() {
  if (!marketDataConfigured()) return Response.json({ ok: false, error: "not-configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    const { quotes, charts, at, filled } = await loadBoardSnapshot();
    const any = Object.keys(quotes).length > 0;
    return Response.json({ ok: true, quotes, charts, at: at === null ? null : new Date(at).toISOString() },
      { headers: { "Cache-Control": any && !filled ? "public, s-maxage=30, stale-while-revalidate=30" : "no-store" } });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
