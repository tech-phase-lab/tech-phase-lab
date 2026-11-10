import { loadBars, marketDataConfigured } from "@/lib/research/market-data";
import { isChartRange, TICKER_RE } from "@/lib/research/market-quote";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams, ticker = (params.get("ticker") ?? "").toUpperCase(), range = params.get("range") ?? "1m";
  if (!TICKER_RE.test(ticker) || !isChartRange(range)) return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  if (!marketDataConfigured()) return Response.json({ ok: false, error: "not-configured" }, { status: 503 });
  try {
    const bars = await loadBars(ticker, range);
    if (!bars.length) return Response.json({ ok: false, error: "no-data" }, { status: 404 });
    return Response.json({ ok: true, bars }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503 }); }
}
