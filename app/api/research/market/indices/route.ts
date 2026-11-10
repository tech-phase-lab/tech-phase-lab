import { loadIndices, marketDataConfigured } from "@/lib/research/market-data";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET() {
  if (!marketDataConfigured()) return Response.json({ ok: false, error: "not-configured" }, { status: 503 });
  try {
    const items = await loadIndices();
    if (!items.length) return Response.json({ ok: false, error: "no-data" }, { status: 503 });
    return Response.json({ ok: true, items }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" } });
  } catch { return Response.json({ ok: false, error: "unavailable" }, { status: 503 }); }
}
