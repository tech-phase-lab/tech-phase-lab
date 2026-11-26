import { historyRange } from "@/lib/research/earnings-results-history";
import { loadEarningsHistory } from "@/lib/research/earnings-history-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** Earnings results of a month for the calendar's 「発表済みの結果」 (owner, Nov 18): every result the monitor stored, not only the
 * news feed's last seven days, plus the committed SEC backfill. The calendar and the earnings key figures are FREE (policy of
 * Oct 25), so this answer is the same for every visitor. A day is added on each side so the page can file a result under its
 * own time zone's date (JST or ET). */
export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  const range = historyRange(month);
  if (!range) return Response.json({ ok: false, error: "invalid-month" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const { resultBriefs, months, complete } = await loadEarningsHistory(range);
  return Response.json({ ok: true, month, resultBriefs, months, complete }, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=600", "X-Content-Type-Options": "nosniff" },
  });
}
