import { getMembership } from "@/lib/membership/server";
import { FREE_SAMPLE_TICKER, mapAccess } from "@/lib/research/map-access";
import { chainDataFor } from "@/lib/research/chain-map-data";
import { companyNetworkFor } from "@/lib/research/chain-network.server";
import { companyIntroductions } from "@/lib/research/company-introductions";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** The relationship map of one company. NVDA is the free sample; every other map needs PRO (or the owner account).
 * The maps live only on the server, so a free visitor cannot read them out of the page's code. */
export async function GET(request: Request) {
  try {
    const ticker = (new URL(request.url).searchParams.get("ticker") ?? "").trim().toUpperCase();
    if (!/^[A-Z.]{1,6}$/.test(ticker)) return Response.json({ ok: false, error: "bad-ticker" }, { status: 400, headers });
    // The sample needs no membership lookup at all.
    const member = ticker === FREE_SAMPLE_TICKER ? null : await getMembership();
    const access = mapAccess(member, ticker);
    if (access !== 200) return Response.json({ ok: false, error: access === 401 ? "sign-in" : access === 403 ? "pro-required" : "unavailable" }, { status: access, headers });
    const chain = chainDataFor(ticker);
    if (chain) return Response.json({ ok: true, ticker, chain, sample: ticker === FREE_SAMPLE_TICKER }, { headers });
    const intro = companyIntroductions.find(item => item.tickers.includes(ticker));
    const graph = intro ? companyNetworkFor({ cik: intro.cik, ticker }) : null;
    if (!graph) return Response.json({ ok: false, error: "no-map" }, { status: 404, headers });
    return Response.json({ ok: true, ticker, graph, sample: false }, { headers });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers }); }
}
