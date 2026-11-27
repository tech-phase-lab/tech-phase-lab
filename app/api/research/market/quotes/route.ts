import { isMarketChartSymbol, loadIntraday, loadMarketQuotesWithRefresh, marketDataConfigured } from "@/lib/research/market-data";
import { TICKER_RE, quoteAnswer } from "@/lib/research/market-quote";
import { marketAccess } from "@/lib/research/market-access";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" };
const fastHeaders = { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=5" };
/** An answer holding an earlier copy (its slot is being read, or the plan's minute had no room): kept by the shared cache one second only. */
const staleHeaders = { "Cache-Control": "public, s-maxage=1" };
/** Quotes for up to 100 tickers (the watchlist and the cards). `history=1` adds the day's 5-minute closes for the sparklines.
 * `fast=1` (the watchlist and a stock's page, polled every 15 seconds): a quote older than 15 seconds is read again while the plan's minute
 * leaves room (lib/research/quote-refresh-gate.ts), otherwise it is kept a minute as before. `X-Quote-Refresh` says which (15s / 60s).
 * A quote the plan's minute had no room for is the last good copy (its own time is in `asOf`); `X-Quote-Stale` counts them.
 * Visitors who are not signed in: known symbols only (others are left out of the answer, which is then not cached) and a per-address
 * limit (lib/research/market-access.ts); members any symbol; the owner's accounts everything. */
export async function GET(request: Request) {
  if (!marketDataConfigured()) return Response.json({ ok: false, error: "not-configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const params = new URL(request.url).searchParams;
  const tickers = [...new Set((params.get("tickers") ?? "").toUpperCase().split(",").filter(Boolean))];
  if (!tickers.length || tickers.length > 100 || tickers.some(t => !TICKER_RE.test(t))) return Response.json({ ok: false, error: "bad-tickers" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const access = await marketAccess(request, "light", isMarketChartSymbol);
  if (access instanceof Response) return access;
  const readable = tickers.filter(access.allowed), partial = readable.length < tickers.length;
  try {
    const fast = params.get("fast") === "1";
    const { quotes, fast: granted, stale } = readable.length ? await loadMarketQuotesWithRefresh(readable, { fast }) : { quotes: {}, fast: false, stale: 0 };
    // Every quote an earlier copy: no refresh happened, so none is reported.
    const allStale = stale > 0 && stale >= Object.keys(quotes).length;
    const history = params.get("history") === "1" ? await loadIntraday(Object.values(quotes).slice(0, 30)) : {};
    return Response.json({ ok: true, quotes: quoteAnswer(quotes, history) }, { headers: { ...(partial ? { "Cache-Control": "no-store" } : stale ? staleHeaders : fast ? fastHeaders : headers), ...(allStale ? {} : { "X-Quote-Refresh": granted ? "15s" : "60s" }), "X-Quote-Stale": String(stale) } });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
