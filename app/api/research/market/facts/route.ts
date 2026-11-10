import { loadMarketFacts, marketDataConfigured } from "@/lib/research/market-data";
import { TICKER_RE } from "@/lib/research/market-quote";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: Request) {
  const ticker = (new URL(request.url).searchParams.get("ticker") ?? "").toUpperCase();
  if (!TICKER_RE.test(ticker)) return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  if (!marketDataConfigured()) return Response.json({ ok: false, error: "not-configured" }, { status: 503 });
  return Response.json({ ok: true, facts: await loadMarketFacts(ticker) }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
