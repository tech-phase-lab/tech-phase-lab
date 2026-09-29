import { getMembership } from "@/lib/membership/server";
import { comparisonCatalog } from "@/lib/research/comparison-catalog";
import { buildComparison, comparisonAccess, validateComparisonTickers } from "@/lib/research/comparison";
import { loadComparisonFinancials } from "@/lib/research/comparison-server";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function GET(request: Request) {
  try {
    const member = await getMembership();
    const access = comparisonAccess(member);
    if (access !== 200) return Response.json({ ok: false, error: access === 401 ? "sign-in" : access === 403 ? "pro-required" : "unavailable" }, { status: access, headers });
    const raw = new URL(request.url).searchParams.get("tickers") || "";
    const tickers = raw.length <= 60 ? validateComparisonTickers(raw.split(","), comparisonCatalog.map(c => c.ticker)) : null;
    if (!tickers) return Response.json({ ok: false, error: "select-two-or-three" }, { status: 400, headers });
    const companies = await Promise.all(tickers.map(async ticker => ({ ...comparisonCatalog.find(c => c.ticker === ticker)!, ...await loadComparisonFinancials(ticker) })));
    // The entitlement may expire while upstream data is being fetched.
    if (comparisonAccess(member) !== 200) return Response.json({ ok: false, error: "pro-required" }, { status: 403, headers });
    return Response.json({ ok: true, result: buildComparison(companies), validUntil: "accessExpiresAt" in member ? member.accessExpiresAt : 0 }, { headers });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers }); }
}
