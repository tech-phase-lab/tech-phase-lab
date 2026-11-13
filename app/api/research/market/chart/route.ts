import { isMarketChartSymbol, loadBarSet, loadPeriodSet, marketDataConfigured } from "@/lib/research/market-data";
import { isBoardPeriod, isIntradayPeriod } from "@/lib/research/market-board-periods";
import { isChartRange, TICKER_RE } from "@/lib/research/market-quote";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams, ticker = (params.get("ticker") ?? "").toUpperCase(), range = params.get("range") ?? "1m", period = params.get("period");
  // `period`: the period buttons (5m … 5y) of the market board and of a stock's page; `range` (ytd) for the stock page's year to date.
  if (period !== null) {
    if (!isBoardPeriod(period) || !(TICKER_RE.test(ticker) || isMarketChartSymbol(ticker))) return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
    if (!marketDataConfigured()) return Response.json({ ok: false, error: "not-configured" }, { status: 503 });
    try {
      const { bars, before } = await loadPeriodSet(ticker, period);
      if (!bars.length) return Response.json({ ok: false, error: "no-data" }, { status: 404 });
      return Response.json({ ok: true, bars, before }, { headers: { "Cache-Control": isIntradayPeriod(period) ? "public, s-maxage=10, stale-while-revalidate=5" : "public, s-maxage=30, stale-while-revalidate=30" } });
    } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503 }); }
  }
  if (!(TICKER_RE.test(ticker) || isMarketChartSymbol(ticker)) || !isChartRange(range)) return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  if (!marketDataConfigured()) return Response.json({ ok: false, error: "not-configured" }, { status: 503 });
  try {
    const { bars, before } = await loadBarSet(ticker, range);
    if (!bars.length) return Response.json({ ok: false, error: "no-data" }, { status: 404 });
    return Response.json({ ok: true, bars, before }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503 }); }
}
