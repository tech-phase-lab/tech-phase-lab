import { radarFreshness } from "@/lib/research/radar-freshness";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };

/** Which Financial Radar companies lag their newest SEC filing by more than two days (lib/research/radar-freshness.ts). Public, so it
 * answers tickers and codes only ("NBIS", "behind"): no figures and no periods (the period a dot covers is a PRO detail). Checked at most
 * once an hour; each check also writes one log line, `radar-stale NBIS:behind,...` or `radar-fresh all 54`. */
export async function GET() {
  try {
    const { checkedAt, storage, total, stale } = await radarFreshness();
    return Response.json({ ok: true, checkedAt, storage, total, stale: stale.map(({ ticker, code }) => ({ ticker, code })) }, { headers });
  } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
