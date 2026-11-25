import { loadLeveragedSnapshot, marketDataConfigured } from "@/lib/research/market-data";
import { leveragedRows } from "@/lib/research/leveraged-etfs";
import { toFavoriteQuote } from "@/lib/research/market-quote";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
/** マーケット「レバETF」: one row per long 2x / 3x fund with its price, day change, volume, the current pre-market / after-hours price, and the
 * day change of the stock under it — always the whole list from the shared snapshot (owner, Nov 25), which the site's minute job refreshes in
 * the background (lib/research/market-data.ts refreshLeveragedSnapshot). A member's request never asks the provider (except the very first fill
 * of a new snapshot). `at`: the time of the oldest fund quote in it; the screen shows it once it is old. A fund the provider cannot serve is absent. */
export async function GET() {
  if (!marketDataConfigured()) return Response.json({ ok: false, error: "not-configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    const { quotes, at, filled } = await loadLeveragedSnapshot();
    const now = Date.now();
    const shaped = Object.fromEntries(Object.entries(quotes).map(([symbol, q]) => [symbol, { price: q.price, percentChange: q.percentChange, volume: q.volume, extended: toFavoriteQuote(q, [], now).extended ?? null }]));
    const rows = leveragedRows(shaped);
    return Response.json({ ok: true, rows, at: at === null ? null : new Date(at).toISOString() }, { headers: { "Cache-Control": rows.length && !filled ? "public, s-maxage=30, stale-while-revalidate=30" : "no-store" } });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
