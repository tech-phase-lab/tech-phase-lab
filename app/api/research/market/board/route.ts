import { isMarketChartSymbol, loadBoard, marketDataConfigured } from "@/lib/research/market-data";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
/** One quote per requested market symbol (ETFs, forex, crypto, metals). A symbol the provider cannot serve is absent from the answer, never an error. */
export async function GET(request: Request) {
  if (!marketDataConfigured()) return Response.json({ ok: false, error: "not-configured" }, { status: 503 });
  const ids = [...new Set((new URL(request.url).searchParams.get("ids") ?? "").split(",").map(id => id.trim().toUpperCase()).filter(Boolean))];
  if (!ids.length || ids.length > 24 || !ids.every(isMarketChartSymbol)) return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  try {
    return Response.json({ ok: true, items: await loadBoard(ids) }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" } });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503 }); }
}
