/**
 * Earlier releases of an economic indicator from FRED (owner, Nov 28: the opened row's bars showed only the two results stored so far).
 * Only the five periods before a stored result are taken from here; the result itself, and any period the site stored, stay the site's.
 * FRED's figures can be revised after the first release; they are shown as FRED has them, without a note (owner, Nov 28).
 * Pure helpers: the series per indicator, the CSV reader and the change computed from levels. The fetch is server-only
 * (economic-history-server.ts).
 */
export type BackfillPoint = { period: string; value: number; decimals: number };
/** Per indicator key ("claims", "pce", …): its periods oldest first. Weekly periods are the week-ending day (YYYY-MM-DD), monthly
 * ones YYYY-MM, quarterly ones YYYY-Qn. */
export type Backfill = Record<string, BackfillPoint[]>;

type Transform = "level" | "mom-pct" | "change" | "change-thousands";
/** The FRED series behind each indicator the site posts, and how its headline is made from it. ISM's PMI and the FOMC decisions have
 * no FRED series for the headline (ISM is not on FRED; FOMC meets eight times a year), so their bars come from stored results only. */
export const FRED_SERIES: Record<string, { id: string; transform: Transform; frequency: "week" | "month" | "quarter" }> = {
  claims: { id: "ICSA", transform: "level", frequency: "week" },
  pce: { id: "PCEPI", transform: "mom-pct", frequency: "month" },
  retail: { id: "RSAFS", transform: "mom-pct", frequency: "month" },
  adp: { id: "ADPMNUSNERSA", transform: "change", frequency: "month" },
  jobs: { id: "PAYEMS", transform: "change-thousands", frequency: "month" },
  cpi: { id: "CPIAUCSL", transform: "mom-pct", frequency: "month" },
  ppi: { id: "PPIFIS", transform: "mom-pct", frequency: "month" },
  gdp: { id: "A191RL1Q225SBEA", transform: "level", frequency: "quarter" },
};

/** "observation_date,ICSA\n2026-11-21,189000" -> [{ date, value }] oldest first; a missing value (".") is skipped. */
export function readFredCsv(text: string): { date: string; value: number }[] {
  return text.trim().split(/\r?\n/).slice(1).map(line => line.split(","))
    .filter(([date, value]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && value?.trim() && Number.isFinite(Number(value)))
    .map(([date, value]) => ({ date, value: Number(value) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// A quarter from its month: Jan–Mar Q1 … Oct–Dec Q4 (FRED dates a quarter by its first month, but any month of it reads the same).
const periodOf = (date: string, frequency: "week" | "month" | "quarter") => frequency === "week" ? date
  : frequency === "month" ? date.slice(0, 7) : `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;

/** Rounded to one decimal, half away from zero, the way BLS, BEA and the Census Bureau print a percent change. `toFixed` on the raw
 * float can round a true half down (0.25 is stored as 0.2499…), so a tiny tolerance is added before rounding. */
export function roundHalfAway(value: number, decimals = 1) {
  const scale = 10 ** decimals;
  const rounded = Math.round(Math.abs(value) * scale + 1e-9) / scale;
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}

/** The indicator's headline per period from the series' observations: a level as is, a month-over-month change in % (one decimal, as
 * the agencies publish it), or the change in persons from the month before. A change needs the month just before it. */
export function fromObservations(key: string, rows: { date: string; value: number }[]): BackfillPoint[] {
  const spec = FRED_SERIES[key];
  if (!spec) return [];
  const out: BackfillPoint[] = [];
  rows.forEach((row, index) => {
    const period = periodOf(row.date, spec.frequency);
    if (spec.transform === "level") { out.push({ period, value: row.value, decimals: key === "gdp" ? 1 : 0 }); return; }
    const before = rows[index - 1];
    if (!before || periodOf(before.date, "month") !== shiftMonth(period, -1)) return;
    if (spec.transform === "mom-pct") { if (before.value) out.push({ period, value: roundHalfAway((row.value / before.value - 1) * 100), decimals: 1 }); return; }
    out.push({ period, value: Math.round((row.value - before.value) * (spec.transform === "change-thousands" ? 1000 : 1)), decimals: 0 });
  });
  return out;
}

/** "2026-10" moved by n months. */
export function shiftMonth(period: string, n: number) {
  const date = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1 + n, 1));
  return date.toISOString().slice(0, 7);
}
/** "2026-Q3" moved by n quarters. */
export function shiftQuarter(period: string, n: number) {
  const index = Number(period.slice(0, 4)) * 4 + Number(period.slice(6)) - 1 + n;
  return `${Math.floor(index / 4)}-Q${index % 4 + 1}`;
}
/** "2026-11-21" moved by n weeks. */
export function shiftWeek(day: string, n: number) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 7 * 86_400_000).toISOString().slice(0, 10);
}

/** ISM's Manufacturing PMI is not on FRED, so its earlier months are kept here, each from ISM's own monthly release on PR Newswire
 * (prnewswire.com/news/institute-for-supply-management/, "Manufacturing PMI® at X%; <Month> 2026 ISM® Manufacturing PMI® Report",
 * read 2026-11-28). Keyed by the month the index covers. */
export const ISM_HISTORY: BackfillPoint[] = [
  ["2026-03", 52.7], ["2026-04", 52.7], ["2026-05", 54.0], ["2026-06", 53.3], ["2026-07", 55.6], ["2026-08", 54.6], ["2026-09", 54.5], ["2026-10", 55.5],
].map(([period, value]) => ({ period: period as string, value: value as number, decimals: 1 }));

/** Only what the bars need: the last 14 points per indicator, numbers only. */
export function parseBackfill(value: unknown): Backfill {
  const out: Backfill = {};
  if (!value || typeof value !== "object") return out;
  for (const key of Object.keys(FRED_SERIES)) {
    const list = (value as Record<string, unknown>)[key];
    if (!Array.isArray(list)) continue;
    out[key] = list.slice(-14).filter((point): point is BackfillPoint => !!point && typeof point.period === "string" && /^\d{4}-(?:\d{2}(?:-\d{2})?|Q[1-4])$/.test(point.period)
      && typeof point.value === "number" && Number.isFinite(point.value) && typeof point.decimals === "number" && point.decimals >= 0 && point.decimals <= 3);
  }
  return out;
}
