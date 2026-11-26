import { DIVE_TICKERS } from "@/lib/research/company-dive";
import { loadEffectiveDive, recentBriefs } from "@/lib/research/company-earnings-live.server";
import { liveRelease, sectionReport } from "@/lib/research/company-earnings-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** What each 監視銘柄 company page shows at the top of its earnings section (直近決算), for the monitor's patrol (owner, Nov 26:
 * check regularly that the figures are right). The same for every visitor: only what the page shows everyone (the quarter, the
 * release date and the three tiles) and yes/no answers about the deep dive; never the dive's own (PRO) figures. */
export async function GET() {
  const now = Date.now();
  const briefs = await recentBriefs(now);
  const companies = await Promise.all(DIVE_TICKERS.map(async ticker => {
    const dive = await loadEffectiveDive(ticker, now);
    if (!dive) return { ticker, missing: true };
    const decision = liveRelease(briefs, { ticker, period: dive.period, releasedOn: dive.releasedOn, currency: dive.currency }, now);
    return sectionReport(dive, decision, briefs);
  }));
  return Response.json({ ok: true, monitorRead: briefs !== null, generatedAt: new Date(now).toISOString(), companies }, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=120", "X-Content-Type-Options": "nosniff" },
  });
}
