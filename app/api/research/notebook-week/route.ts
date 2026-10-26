import { getMembership } from "@/lib/membership/server";
import { themeRankingAccess } from "@/lib/research/theme-ranking";
import { loadReturnsFor, themePricesConfigured } from "@/lib/research/theme-prices";
import { cleanTickers, weekSummary } from "@/lib/research/watchlist-week";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** 銘柄手帳: a signed-in member always gets the counts (up / down); only PRO gets which stocks and by how much. */
export async function GET(request: Request) {
  try {
    const member = await getMembership();
    const access = themeRankingAccess(member);
    if (access === 401 || access === 503) return Response.json({ ok: false, error: access === 401 ? "sign-in" : "unavailable" }, { status: access, headers });
    const tickers = cleanTickers(new URL(request.url).searchParams.get("tickers"));
    if (!tickers.length) return Response.json({ ok: false, error: "no-tickers" }, { status: 400, headers });
    if (!themePricesConfigured()) return Response.json({ ok: false, error: "not-connected" }, { status: 503, headers });
    const { stocks, asOf } = await loadReturnsFor(tickers);
    const summary = weekSummary(stocks, tickers);
    // The entitlement may expire while the upstream data is being fetched.
    const full = access === 200 && themeRankingAccess(member) === 200;
    const { ranked, ...counts } = summary;
    return Response.json({ ok: true, asOf, full, ...counts, ...(full ? { ranked } : {}) }, { headers });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers }); }
}
