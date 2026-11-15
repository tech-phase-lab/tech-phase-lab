import { validSyncToken } from "@/lib/membership/sync-auth";
import { warmMinute } from "@/lib/research/comparison-warm";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

/** The comparison's background job: one minute's share of the daily provider refresh (lib/research/comparison-warm.ts). Called once a minute by
 * the Railway monitor (COMPARISON_WARM_URL) or a Vercel Cron, with `Authorization: Bearer <COMPARISON_WARM_SECRET or CRON_SECRET>`.
 * The answer carries tickers and credit counts only, never data or keys. */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!validSyncToken(auth, process.env.COMPARISON_WARM_SECRET) && !validSyncToken(auth, process.env.CRON_SECRET)) return Response.json({ ok: false }, { status: 401, headers });
  try {
    const report = await warmMinute();
    console.info(`comparison warm ${report.minute} spent=${report.spent} tickers=${report.tickers.join(",")} skipped=${report.skipped.join(",") || "-"}`);
    return Response.json({ ok: true, ...report }, { headers });
  } catch (error) {
    console.warn(`comparison warm failed: ${error instanceof Error ? error.message : "error"}`);
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
