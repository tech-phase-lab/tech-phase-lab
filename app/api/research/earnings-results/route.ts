import { checkedBriefs, historyRange, mergeHistory, resultMonths } from "@/lib/research/earnings-results-history";
import { backfillBriefs } from "@/lib/research/earnings-results-backfill";
import { readMonitor } from "@/lib/research/tech-news-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const DAY = 86_400_000;
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** Earnings results of a month for the calendar's 「発表済みの結果」 (owner, Nov 18): every result the monitor stored, not only the
 * news feed's last seven days, plus the committed SEC backfill. The calendar and the earnings key figures are FREE (policy of
 * Oct 25), so this answer is the same for every visitor. A day is added on each side so the page can file a result under its
 * own time zone's date (JST or ET). */
export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  const range = historyRange(month);
  if (!range) return Response.json({ ok: false, error: "invalid-month" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const padded = { from: shift(range.from, -1), to: shift(range.to, 1) };
  let stored: unknown = null;
  try {
    stored = ((await readMonitor("earnings-results", 1_500_000, 8_000, padded)) as { resultBriefs?: unknown }).resultBriefs;
  } catch {
    stored = null; // the backfill still answers; the live feed covers the last seven days
  }
  const backfill = backfillBriefs();
  const resultBriefs = mergeHistory(padded, checkedBriefs(stored), backfill);
  // the month selector lists every month that has results: this answer's and the backfill's
  const months = [...new Set([...resultMonths(resultBriefs), ...resultMonths(backfill)])].filter(value => !!historyRange(value)).sort();
  return Response.json({ ok: true, month, resultBriefs, months, complete: stored !== null }, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=600", "X-Content-Type-Options": "nosniff" },
  });
}
