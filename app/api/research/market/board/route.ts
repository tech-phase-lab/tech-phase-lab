import { isMarketChartSymbol, loadBoard, marketDataConfigured } from "@/lib/research/market-data";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
/** One quote per requested market symbol (ETFs, forex, crypto, metals). A symbol the provider cannot serve is absent from the answer, never an error. */
export async function GET(request: Request) {
  if (!marketDataConfigured()) return Response.json({ ok: false, error: "not-configured" }, { status: 503 });
  const ids = [...new Set((new URL(request.url).searchParams.get("ids") ?? "").split(",").map(id => id.trim().toUpperCase()).filter(Boolean))];
  // `fast=1`: the index cards and the chart being looked at (a quote kept 15 seconds on the server, and in the shared cache for 10). A few symbols at most, so it cannot widen the use of the data plan.
  const fast = new URL(request.url).searchParams.get("fast") === "1";
  if (!ids.length || ids.length > (fast ? 4 : 24) || !ids.every(isMarketChartSymbol)) return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  try {
    return Response.json({ ok: true, items: await loadBoard(ids, fast) }, { headers: { "Cache-Control": fast ? "public, s-maxage=10, stale-while-revalidate=5" : "public, s-maxage=30, stale-while-revalidate=30" } });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503 }); }
}
