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

/** One result of a company: the same release stored by the monitor and read again by the SEC backfill. */
const SAME_RESULT_MS = 36 * 3_600_000;

/** "Q3 FY27", "q3 fy2027", "Q3 FYE27" -> "Q3FY2027"; "Q3 2026" -> "Q32026". */
export function resultPeriodKey(period: string): string {
  return period.toUpperCase().replace(/\s+/g, "").replace(/FYE?(\d\d)$/, "FY20$1");
}

/** The company's own results rows (issuer table, fallback, "announced" line): one row per company and quarter (owner, Nov 19:
 * PANW, NVDA, AMAT, NBIS and CRWV were listed twice in November, once from the monitor and once from the SEC backfill).
 * Rows of one result are the same company with the same quarter (written either way), or within 36 hours of each other.
 * The row with more figures is kept whole, on a tie the monitor's (an earlier list, or a row that carries its detection timing);
 * the other row's figures are never mixed in. Third-party posts (x-result-) are left as they are. */
export function oneResultPerQuarter(...lists: ResultBrief[][]): ResultBrief[] {
  const rows = lists.flatMap((list, index) => list.map(brief => ({ brief, monitor: index === 0 || brief.detectionToPublicMs !== null })));
  const better = (a: typeof rows[number], b: typeof rows[number]) =>
    a.brief.facts.length !== b.brief.facts.length ? a.brief.facts.length > b.brief.facts.length : a.monitor && !b.monitor;
  const kept: typeof rows = [];
  for (const row of rows) {
    if (!row.brief.researchId.startsWith("ir-")) { kept.push(row); continue; }
    const ticker = row.brief.ticker.trim().toUpperCase(), period = resultPeriodKey(row.brief.period), at = Date.parse(row.brief.publishedAt);
    const index = kept.findIndex(other => other.brief.researchId.startsWith("ir-") && other.brief.ticker.trim().toUpperCase() === ticker
      && (resultPeriodKey(other.brief.period) === period || Math.abs(Date.parse(other.brief.publishedAt) - at) <= SAME_RESULT_MS));
    if (index < 0) kept.push(row);
    else if (better(row, kept[index])) kept[index] = row;
  }
  return kept.map(row => row.brief);
}

/** The results of [from, to] (UTC days) from every source (the monitor's first), one row per result, newest first. */
export function mergeHistory(range: { from: string; to: string }, ...lists: ResultBrief[][]): ResultBrief[] {
  const start = Date.parse(`${range.from}T00:00:00Z`), stop = Date.parse(`${range.to}T00:00:00Z`) + DAY;
  const seen = new Set<string>();
  const inRange = lists.map(list => list.filter(brief => {
    const at = Date.parse(brief.publishedAt);
    const key = `${brief.researchId}|${brief.url}`;
    if (brief.kind !== "earnings" || !(at >= start && at < stop) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
  return oneResultPerQuarter(...inRange).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, MAX_HISTORY_ROWS);
}
