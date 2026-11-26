import { loadMarketFacts, marketDataConfigured } from "@/lib/research/market-data";
import { TICKER_RE } from "@/lib/research/market-quote";
import { marketAccess } from "@/lib/research/market-access";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: Request) {
  const ticker = (new URL(request.url).searchParams.get("ticker") ?? "").toUpperCase();
  if (!TICKER_RE.test(ticker)) return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  if (!marketDataConfigured()) return Response.json({ ok: false, error: "not-configured" }, { status: 503 });
  // A company nobody has opened costs 70 credits: known symbols only (the owner's accounts: any), and a per-address limit for visitors.
  // Any other symbol has no facts to show ("—", as before for a symbol the provider does not know), and nothing is read for it.
  const access = await marketAccess(request, "heavy");
  if (access instanceof Response) return access;
  if (!access.allowed(ticker)) return Response.json({ ok: true, complete: true, facts: { eps: null, marketCap: null, dividendYield: null, nextEarnings: null } }, { headers: { "Cache-Control": "no-store" } });
  const { complete, ...facts } = await loadMarketFacts(ticker);
  // Production QA, Nov 25: an answer without the statistics (nothing read and no last good copy yet) was kept by the CDN for five minutes and by
  // the page for six hours. It is now never cached, and `complete: false` tells the page to ask again in a minute.
  return Response.json({ ok: true, complete, facts }, { headers: { "Cache-Control": complete ? "public, s-maxage=300, stale-while-revalidate=600" : "no-store" } });
}
