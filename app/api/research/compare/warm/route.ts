import { validSyncToken } from "@/lib/membership/sync-auth";
import { warmMinute } from "@/lib/research/comparison-warm";
import { refreshLeveragedSnapshot } from "@/lib/research/market-data";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

/** The comparison's background job: one minute's share of the daily provider refresh (lib/research/comparison-warm.ts). Called once a minute by
 * the Railway monitor (COMPARISON_WARM_URL) or a Vercel Cron, with `Authorization: Bearer <COMPARISON_WARM_SECRET or CRON_SECRET>`.
 * The same minute first refreshes the マーケット「レバETF」 snapshot (lib/research/market-data.ts refreshLeveragedSnapshot).
 * The answer carries tickers and credit counts only, never data or keys. */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!validSyncToken(auth, process.env.COMPARISON_WARM_SECRET) && !validSyncToken(auth, process.env.CRON_SECRET)) return Response.json({ ok: false }, { status: 401, headers });
  // First the マーケット「レバETF」 snapshot (owner, Nov 25: the whole list at once for every member; ~45 credits a trading minute, never more
  // than 48), then the comparison with what is left of the minute. A failure here never stops the comparison.
  const lev = await refreshLeveragedSnapshot().catch(() => ({ spent: 0, read: 0, failed: -1 }));
  console.info(`leveraged snapshot spent=${lev.spent} read=${lev.read} failed=${lev.failed}`);
  try {
    const report = await warmMinute(Date.now(), lev.spent);
    console.info(`comparison warm ${report.minute} spent=${report.spent} filings=${report.filings ?? 0} tickers=${report.tickers.join(",")} skipped=${report.skipped.join(",") || "-"}`);
    return Response.json({ ok: true, ...report, leveraged: lev }, { headers });
  } catch (error) {
    console.warn(`comparison warm failed: ${error instanceof Error ? error.message : "error"}`);
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
