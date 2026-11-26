import { loadCapitalPortfolios, type CapitalHoldings } from "@/lib/research/capital-map-data";

/** 資本マップ: the holdings of the portfolios a reader chose (`ids=a,b`, or `ids=all` for the stock lookup). Public reported data, the same
 * for everyone and changed only by a deployment, so the CDN and the browser keep it. */
const headers = { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const portfolios = await loadCapitalPortfolios();
  const wanted = raw === "all" ? portfolios.map(item => item.id) : [...new Set(raw.split(",").map(id => id.trim()).filter(Boolean))].slice(0, 40);
  const found = portfolios.filter(item => wanted.includes(item.id));
  if (!found.length) return Response.json({ ok: false, error: "unknown-portfolio" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const holdings: Record<string, CapitalHoldings> = Object.fromEntries(found.map(item => [item.id, { current: item.current, previous: item.previous }]));
  return Response.json({ ok: true, holdings }, { headers });
}
