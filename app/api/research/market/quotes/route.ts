import { loadIntraday, loadMarketQuotes, marketDataConfigured } from "@/lib/research/market-data";
import { TICKER_RE, toFavoriteQuote } from "@/lib/research/market-quote";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" };
/** Quotes for up to 100 tickers (the watchlist and the cards). `history=1` adds the day's 5-minute closes for the sparklines. */
export async function GET(request: Request) {
  if (!marketDataConfigured()) return Response.json({ ok: false, error: "not-configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const params = new URL(request.url).searchParams;
  const tickers = [...new Set((params.get("tickers") ?? "").toUpperCase().split(",").filter(Boolean))];
  if (!tickers.length || tickers.length > 100 || tickers.some(t => !TICKER_RE.test(t))) return Response.json({ ok: false, error: "bad-tickers" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const quotes = await loadMarketQuotes(tickers);
    const history = params.get("history") === "1" ? await loadIntraday(Object.keys(quotes).slice(0, 30)) : {};
    return Response.json({ ok: true, quotes: Object.fromEntries(Object.values(quotes).map(q => [q.ticker, { ...toFavoriteQuote(q, history[q.ticker]), name: q.name, exchange: q.exchange, open: q.open, high: q.high, low: q.low, previousClose: q.previousClose, volume: q.volume, week52Low: q.week52Low, week52High: q.week52High }])) }, { headers });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
