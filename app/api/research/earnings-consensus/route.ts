import { loadEpsConsensus } from "@/lib/research/earnings-consensus";
import { TICKER_RE } from "@/lib/research/market-quote";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const ticker = (q.get("ticker") ?? "").toUpperCase(), at = q.get("at") ?? "", eps = Number(q.get("eps"));
  if (!TICKER_RE.test(ticker) || !Number.isFinite(Date.parse(at)) || q.get("eps") === null || !Number.isFinite(eps)) return Response.json({ ok: false }, { status: 400 });
  return Response.json({ ok: true, consensus: await loadEpsConsensus(ticker, at, eps) }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
