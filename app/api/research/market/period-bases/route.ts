import { loadDailyCloses, marketDataConfigured } from "@/lib/research/market-data";
import { TICKER_RE } from "@/lib/research/market-quote";
import { periodBases } from "@/lib/research/period-change";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const easternDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
/** The closes a stock page measures "the change over the period" from (1W / 1M / 6M / 1Y / YTD / 5Y). The page applies the live price to them,
 * so the line follows every price update. One daily series of about five years per stock, kept 30 minutes (one credit). */
export async function GET(request: Request) {
  const ticker = (new URL(request.url).searchParams.get("ticker") ?? "").toUpperCase();
  if (!TICKER_RE.test(ticker)) return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  if (!marketDataConfigured()) return Response.json({ ok: false, error: "not-configured" }, { status: 503 });
  try {
    const today = easternDay.format(Date.now());
    return Response.json({ ok: true, today, bases: periodBases(await loadDailyCloses(ticker), today) }, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=600" } });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503 }); }
}
