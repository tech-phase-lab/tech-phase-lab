import { loadMarketFacts, marketDataConfigured } from "@/lib/research/market-data";
import { TICKER_RE } from "@/lib/research/market-quote";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: Request) {
  const ticker = (new URL(request.url).searchParams.get("ticker") ?? "").toUpperCase();
  if (!TICKER_RE.test(ticker)) return Response.json({ ok: false, error: "bad-request" }, { status: 400 });
  if (!marketDataConfigured()) return Response.json({ ok: false, error: "not-configured" }, { status: 503 });
  const { complete, ...facts } = await loadMarketFacts(ticker);
  // Production QA, Nov 25: an answer without the statistics (nothing read and no last good copy yet) was kept by the CDN for five minutes and by
  // the page for six hours. It is now never cached, and `complete: false` tells the page to ask again in a minute.
  return Response.json({ ok: true, complete, facts }, { headers: { "Cache-Control": complete ? "public, s-maxage=300, stale-while-revalidate=600" : "no-store" } });
}
