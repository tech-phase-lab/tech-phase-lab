import { validSyncToken } from "@/lib/membership/sync-auth";
import { warmMinute } from "@/lib/research/comparison-warm";
import { refreshBoardSnapshot, refreshLeveragedSnapshot } from "@/lib/research/market-data";
import { refreshFocusSnapshot } from "@/lib/research/search-focus-server";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

/** The comparison's background job: one minute's share of the daily provider refresh (lib/research/comparison-warm.ts). Called once a minute by
 * the Railway monitor (COMPARISON_WARM_URL) or a Vercel Cron, with `Authorization: Bearer <COMPARISON_WARM_SECRET or CRON_SECRET>`.
 * The same minute first refreshes the マーケット「レバETF」 snapshot and the snapshot of the other tabs' cards and first charts
 * (lib/research/market-data.ts refreshLeveragedSnapshot, refreshBoardSnapshot), and the 銘柄検索「今日の注目」 snapshot
 * (lib/research/search-focus-server.ts refreshFocusSnapshot: daily bars once per settled session, at most 24 a minute).
 * The answer carries tickers and credit counts only, never data or keys. */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!validSyncToken(auth, process.env.COMPARISON_WARM_SECRET) && !validSyncToken(auth, process.env.CRON_SECRET)) return Response.json({ ok: false }, { status: 401, headers });
  // First the マーケット「レバETF」 snapshot (owner, Nov 25: the whole list at once for every member; ~45 credits a trading minute, never more
  // than 48), then the comparison with what is left of the minute. A failure here never stops the comparison.
  const lev = await refreshLeveragedSnapshot().catch(() => ({ spent: 0, read: 0, failed: -1 }));
  console.info(`leveraged snapshot spent=${lev.spent} read=${lev.read} failed=${lev.failed}`);
  // Owner, Nov 25: every マーケット tab at once. ~12 credits a minute while U.S. stocks trade (~8 otherwise), never more than 25, on the warm
  // tier (it yields to the member reserve); a copy members already read this minute costs nothing.
  const board = await refreshBoardSnapshot().catch(() => ({ spent: 0, read: 0, failed: -1 }));
  console.info(`board snapshot spent=${board.spent} read=${board.read} failed=${board.failed}`);
  // Owner, Nov 26: 銘柄検索「今日の注目」 and the theme rows' day change. Each stock's daily bars once per settled session (~90 credits a
  // trading day, at most 24 a minute, warm tier), through the same shared bar copies members' reads use.
  const focus = await refreshFocusSnapshot().catch(() => ({ spent: 0, read: 0, copies: 0, failed: -1 }));
  if (focus.spent || focus.copies || focus.failed) console.info(`search focus snapshot spent=${focus.spent} read=${focus.read} copies=${focus.copies} failed=${focus.failed}`);
  try {
    const report = await warmMinute(Date.now(), lev.spent + board.spent + focus.spent);
    console.info(`comparison warm ${report.minute} spent=${report.spent} filings=${report.filings ?? 0} tickers=${report.tickers.join(",")} skipped=${report.skipped.join(",") || "-"}`);
    return Response.json({ ok: true, ...report, leveraged: lev, board, focus }, { headers });
  } catch (error) {
    console.warn(`comparison warm failed: ${error instanceof Error ? error.message : "error"}`);
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
