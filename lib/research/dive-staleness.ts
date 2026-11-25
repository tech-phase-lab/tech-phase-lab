import { calendarEvents, dateOnlyEarnings } from "./calendar.ts";
import backfill from "./earnings-results-history.json" with { type: "json" };

/** A results release the site already knows about: from the earnings calendar (timed and date-only events) and from the committed
 * SEC results backfill (earnings-results-history.json, `companies`: one row per company with its latest results filing). */
export type KnownReport = { ticker: string; on: string; at: number; period: string | null; source: "calendar" | "sec-backfill" };
export type NewerReport = { on: string; period: string | null; source: KnownReport["source"] };

const DAY = 86_400_000;
/** A quarter apart is about 90 days; anything within a week of the shown release is the same release (time zones, call vs. release). */
const SAME_RELEASE_DAYS = 7;
const newYorkDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export function knownReports(): KnownReport[] {
  const rows = (backfill as { companies?: { ticker?: unknown; reportedAt?: unknown; period?: unknown }[] }).companies ?? [];
  const reports: KnownReport[] = [
    ...calendarEvents.filter(e => e.kind === "earnings" && e.ticker).map(e => ({ ticker: e.ticker!, on: newYorkDate(e.startsAt), at: Date.parse(e.startsAt), period: null, source: "calendar" as const })),
    ...dateOnlyEarnings.filter(e => e.ticker).map(e => ({ ticker: e.ticker!, on: e.date, at: Date.parse(`${e.date}T23:59:59Z`), period: null, source: "calendar" as const })),
    ...rows.filter(r => typeof r.ticker === "string" && typeof r.reportedAt === "string")
      .map(r => ({ ticker: r.ticker as string, on: newYorkDate(r.reportedAt as string), at: Date.parse(r.reportedAt as string), period: typeof r.period === "string" ? r.period : null, source: "sec-backfill" as const })),
  ];
  return reports.filter(r => Number.isFinite(r.at));
}

/**
 * The newest release the site knows for `ticker` that is already out (`now`) and more than a week after `releasedOn`, the release the
 * page shows; null when the page's quarter is the latest. The page then does not call its quarter 直近 and logs it.
 */
export function newerReport(ticker: string, releasedOn: string, now = Date.now(), reports: KnownReport[] = knownReports()): NewerReport | null {
  const shown = Date.parse(`${releasedOn}T00:00:00Z`);
  if (!Number.isFinite(shown)) return null;
  const newer = reports.filter(r => r.ticker === ticker && r.at <= now && Date.parse(`${r.on}T00:00:00Z`) - shown > SAME_RELEASE_DAYS * DAY)
    .sort((a, b) => b.on.localeCompare(a.on));
  if (!newer.length) return null;
  // On one day, the row that names the quarter (the SEC results data) is the better report.
  const best = newer.find(r => r.on === newer[0].on && r.period) ?? newer[0];
  return { on: best.on, period: best.period, source: best.source };
}
