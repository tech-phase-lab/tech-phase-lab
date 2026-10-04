import { getMembership } from "@/lib/membership/server";
import { buildComparison, comparisonAccess, validateComparisonTickers } from "@/lib/research/comparison";
import { loadComparisonFinancials, resolveComparisonCompany } from "@/lib/research/comparison-server";
import { buildReviewedTrial } from "@/lib/research/comparison-trial";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function GET(request: Request) {
  try {
    const member = await getMembership();
    const access = comparisonAccess(member);
    if (access !== 200) return Response.json({ ok: false, error: access === 401 ? "sign-in" : access === 403 ? "pro-required" : "unavailable" }, { status: access, headers });
    const raw = new URL(request.url).searchParams.get("tickers") || "";
    const tickers = raw.length <= 60 ? validateComparisonTickers(raw.split(","), raw.split(",")) : null;
    if (!tickers || tickers.some(ticker => !/^[A-Z0-9.\-]{1,15}$/.test(ticker))) return Response.json({ ok: false, error: "select-two-or-three" }, { status: 400, headers });
    const trial = new URL(request.url).searchParams.get("trial");
    if (trial) {
      const result = trial === "mu-sndk-20261004" ? buildReviewedTrial(tickers) : null;
      if (!result) return Response.json({ok:false,error:"unknown-trial"},{status:400,headers});
      return Response.json({ok:true,result,validUntil:"accessExpiresAt" in member ? member.accessExpiresAt : 0},{headers});
    }
    const selected = await Promise.all(tickers.map(resolveComparisonCompany));
    if (selected.some(c => !c)) return Response.json({ ok: false, error: "unknown-company" }, { status: 400, headers });
    const companies = await Promise.all(selected.map(async company => ({ ...company!, ...await loadComparisonFinancials(company!.ticker) })));
    // The entitlement may expire while upstream data is being fetched.
    if (comparisonAccess(member) !== 200) return Response.json({ ok: false, error: "pro-required" }, { status: 403, headers });
    return Response.json({ ok: true, result: buildComparison(companies), validUntil: "accessExpiresAt" in member ? member.accessExpiresAt : 0 }, { headers });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers }); }
}
