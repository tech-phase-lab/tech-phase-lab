import { loadEpsConsensus } from "@/lib/research/earnings-consensus";
import { TICKER_RE } from "@/lib/research/market-quote";
import { marketAccess } from "@/lib/research/market-access";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const ticker = (q.get("ticker") ?? "").toUpperCase(), at = q.get("at") ?? "", eps = Number(q.get("eps"));
  if (!TICKER_RE.test(ticker) || !Number.isFinite(Date.parse(at)) || q.get("eps") === null || !Number.isFinite(eps)) return Response.json({ ok: false }, { status: 400 });
  // 20 credits a company: known symbols only (the owner's accounts: any), and a per-address limit for visitors. Any other symbol has
  // no consensus to show, as when the provider has none.
  const access = await marketAccess(request, "heavy");
  if (access instanceof Response) return access;
  if (!access.allowed(ticker)) return Response.json({ ok: true, consensus: null }, { headers: { "Cache-Control": "no-store" } });
  return Response.json({ ok: true, consensus: await loadEpsConsensus(ticker, at, eps) }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
