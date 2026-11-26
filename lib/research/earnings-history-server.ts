import "server-only";
import { checkedBriefs, historyRange, mergeHistory, resultMonths } from "./earnings-results-history";
import { backfillBriefs } from "./earnings-results-backfill";
import { readMonitor } from "./tech-news-server";

const DAY = 86_400_000;
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** The calendar's stored earnings results of a month (/api/research/earnings-results, and the calendar's first HTML): every result the
 * monitor stored plus the committed SEC backfill, a day added on each side so the page can file a result under its own time zone's date.
 * FREE (policy of Oct 25): the same for every visitor. */
export async function loadEarningsHistory(range: NonNullable<ReturnType<typeof historyRange>>, timeoutMs = 8_000) {
  const padded = { from: shift(range.from, -1), to: shift(range.to, 1) };
  let stored: unknown = null;
  try {
    stored = ((await readMonitor("earnings-results", 1_500_000, timeoutMs, padded)) as { resultBriefs?: unknown }).resultBriefs;
  } catch {
    stored = null; // the backfill still answers; the live feed covers the last seven days
  }
  const backfill = backfillBriefs();
  const resultBriefs = mergeHistory(padded, checkedBriefs(stored), backfill);
  // the month selector lists every month that has results: this answer's and the backfill's
  const months = [...new Set([...resultMonths(resultBriefs), ...resultMonths(backfill)])].filter(value => !!historyRange(value)).sort();
  return { resultBriefs, months, complete: stored !== null };
}
