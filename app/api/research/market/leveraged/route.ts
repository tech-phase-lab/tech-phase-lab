import { loadLeveragedQuotes, marketDataConfigured } from "@/lib/research/market-data";
import { LEVERAGED_SYMBOLS, leveragedRows } from "@/lib/research/leveraged-etfs";
import { toFavoriteQuote } from "@/lib/research/market-quote";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
/** マーケット「レバETF」: one row per long 2x / 3x fund with its price, day change, volume, the current pre-market / after-hours price, and the
 * day change of the stock under it. A fund the provider cannot serve is absent. `missing` counts symbols not read yet (asked on the next poll).
 * A partial answer is never kept by the CDN (Nov 25: a cached first answer with no rows was served again to the list's quick retry, which
 * then showed 「読み込み中…」 for as long as the copy lived); a complete one is shared for 30 seconds. */
export async function GET() {
  if (!marketDataConfigured()) return Response.json({ ok: false, error: "not-configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    const { quotes, missing } = await loadLeveragedQuotes(LEVERAGED_SYMBOLS);
    const now = Date.now();
    const shaped = Object.fromEntries(Object.entries(quotes).map(([symbol, q]) => [symbol, { price: q.price, percentChange: q.percentChange, volume: q.volume, extended: toFavoriteQuote(q, [], now).extended ?? null }]));
    return Response.json({ ok: true, rows: leveragedRows(shaped), missing, at: new Date(now).toISOString() }, { headers: { "Cache-Control": missing > 0 ? "no-store" : "public, s-maxage=30, stale-while-revalidate=30" } });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
