import { parseResultBriefs, type ResultBrief } from "./market-results.ts";

/** The calendar's 「発表済みの結果」 by month (owner, Nov 18). The news feed keeps results for about seven days, so an older
 * month came up empty. A month is answered from the monitor's stored results (every flash and "announced" line it kept) and
 * from the SEC backfill committed in earnings-results-history.json (scripts/research/earnings_history_backfill.py).
 * No JSON here: the page imports these helpers, the backfill file is read by the API route only (earnings-results-backfill.ts). */

export const RESULTS_MONTH = /^(20[2-9]\d)-(0[1-9]|1[0-2])$/;
/** The most rows one answer carries (50 companies over about three months). */
export const MAX_HISTORY_ROWS = 400;
const DAY = 86_400_000;

/** "2026-10" -> the first and last day of that month; "recent" -> the first day of the month two months back to the end of this
 * month (at most 92 days; with a day on each side inside the monitor's 95-day bound). Null for anything else or a month after this one. */
export function historyRange(month: string, now = Date.now()): { from: string; to: string } | null {
  const today = new Date(now);
  const end = (year: number, monthIndex: number) => new Date(Date.UTC(year, monthIndex + 1, 1) - DAY).toISOString().slice(0, 10);
  if (month === "recent") {
    const year = today.getUTCFullYear(), index = today.getUTCMonth();
    return { from: new Date(Date.UTC(year, index - 2, 1)).toISOString().slice(0, 10), to: end(year, index) };
  }
  const match = RESULTS_MONTH.exec(month);
  if (!match) return null;
  const year = Number(match[1]), index = Number(match[2]) - 1;
  if (Date.UTC(year, index, 1) > Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)) return null;
  return { from: `${match[1]}-${match[2]}-01`, to: end(year, index) };
}

/** Each stored result checked on its own with the news feed's rules: one malformed row never hides the others. */
export function checkedBriefs(value: unknown): ResultBrief[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_HISTORY_ROWS).flatMap(raw => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    // Delivery timings are not shown here and the backfill has none (it was read after the fact, not detected live).
    const duration = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 7 * DAY ? value : null;
    const filled = { ...row, publicAt: row.publicAt ?? row.publishedAt, processingMs: duration(row.processingMs) ?? 0,
      sourceToDetectionMs: duration(row.sourceToDetectionMs), detectionToPublicMs: duration(row.detectionToPublicMs) };
    try { return parseResultBriefs([filled], 1); } catch { return []; }
  });
}

/** The UTC months ("2026-10") these results fall in, oldest first. */
export function resultMonths(briefs: ResultBrief[]): string[] {
  return [...new Set(briefs.map(brief => new Date(brief.publishedAt).toISOString().slice(0, 7)))].sort();
}

/** The results of [from, to] (UTC days) from every source, one copy of each, newest first. */
export function mergeHistory(range: { from: string; to: string }, ...lists: ResultBrief[][]): ResultBrief[] {
  const start = Date.parse(`${range.from}T00:00:00Z`), stop = Date.parse(`${range.to}T00:00:00Z`) + DAY;
  const seen = new Set<string>();
  return lists.flat().filter(brief => {
    const at = Date.parse(brief.publishedAt);
    const key = `${brief.researchId}|${brief.url}`;
    if (brief.kind !== "earnings" || !(at >= start && at < stop) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, MAX_HISTORY_ROWS);
}
