/** Quarterly revenue from the SEC's company facts, for the "売上高の推移" chart of 決算の深掘り (owner, Nov 6).
 * Only a revenue that a 10-Q reports for one quarter, or that a 10-K's year minus the three quarters gives for the fourth, is used.
 * The latest quarter is never taken from here: the issuer's release comes first and the screen draws it itself. */
export type HistoryQuarter = { label: string; fiscalYear: number; quarter: number; end: string; value: number };

const REVENUE_TAGS = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"] as const;
const DAY = 86_400_000;
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;
type Fact = { start: string; end: string; val: number; form: string; filed: string };

function facts(root: unknown, tag: string): Fact[] {
  const units = (((root as { facts?: Record<string, Record<string, { units?: Record<string, unknown[]> }>> })?.facts?.["us-gaap"]?.[tag])?.units?.USD) ?? [];
  const seen = new Map<string, Fact>();
  for (const raw of units) {
    const f = raw as Record<string, unknown>;
    if (typeof f.val !== "number" || !Number.isFinite(f.val) || f.val <= 0 || typeof f.start !== "string" || typeof f.end !== "string" || typeof f.form !== "string" || typeof f.filed !== "string") continue;
    if (!/^10-[KQ](?:\/A)?$/.test(f.form) || !Number.isFinite(day(f.start)) || !Number.isFinite(day(f.end))) continue;
    const key = `${f.start}/${f.end}`;
    const old = seen.get(key);
    if (!old || f.filed > old.filed) seen.set(key, { start: f.start, end: f.end, val: f.val, form: f.form, filed: f.filed });
  }
  return [...seen.values()];
}

/** Up to `limit` standalone quarters, oldest first, each labelled with its fiscal quarter. Empty when the tag cannot give a clean series. */
export function quarterlyRevenue(root: unknown, limit = 8): HistoryQuarter[] {
  let best: HistoryQuarter[] = [];
  for (const tag of REVENUE_TAGS) {
    const all = facts(root, tag);
    const quarters = all.filter(f => { const n = day(f.end) - day(f.start); return f.form.startsWith("10-Q") && n >= 80 && n <= 100; });
    const years = all.filter(f => { const n = day(f.end) - day(f.start); return f.form.startsWith("10-K") && n >= 350 && n <= 380; }).sort((a, b) => a.end.localeCompare(b.end));
    if (quarters.length < 3 || !years.length) continue;
    const rows: { fiscalYear: number; end: string; value: number; order: number }[] = [];
    const fiscalYearOf = (end: string) => { const year = years.find(y => y.end >= end && y.start <= end); return year ? Number(year.end.slice(0, 4)) : (years.length && end > years[years.length - 1].end ? Number(years[years.length - 1].end.slice(0, 4)) + 1 : null); };
    for (const q of quarters) {
      const fy = fiscalYearOf(q.end);
      if (fy !== null) rows.push({ fiscalYear: fy, end: q.end, value: q.val, order: day(q.end) });
    }
    // The fourth quarter: the year minus its three 10-Q quarters (only when all three are there).
    for (const year of years) {
      const inside = quarters.filter(q => q.start >= year.start && q.end < year.end);
      if (new Set(inside.map(q => q.end)).size === 3) rows.push({ fiscalYear: Number(year.end.slice(0, 4)), end: year.end, value: year.val - inside.reduce((sum, q) => sum + q.val, 0), order: day(year.end) });
    }
    const unique = [...new Map(rows.map(r => [r.end, r])).values()].filter(r => r.value > 0).sort((a, b) => a.order - b.order);
    const labelled: HistoryQuarter[] = [];
    for (const row of unique) {
      const sameYear = unique.filter(r => r.fiscalYear === row.fiscalYear && r.order <= row.order);
      labelled.push({ label: `Q${sameYear.length}`, fiscalYear: row.fiscalYear, quarter: sameYear.length, end: row.end, value: row.value / 1_000_000 });
    }
    const recent = labelled.slice(-limit);
    if (recent.length > best.length || (recent.length === best.length && recent.length && recent[recent.length - 1].end > best[best.length - 1].end)) best = recent;
  }
  return best;
}

/** The chart's earlier bars: quarters before (fiscalYear, quarter), the one the issuer's release has just reported. */
export function barsBefore(series: HistoryQuarter[], fiscalYear: number, quarter: number, limit = 7): HistoryQuarter[] {
  return series.filter(q => q.fiscalYear < fiscalYear || (q.fiscalYear === fiscalYear && q.quarter < quarter)).slice(-limit);
}

const CIK: Record<string, string> = { MU: "0000723125" };
let cache: { at: number; ticker: string; series: HistoryQuarter[] } | null = null;
/** Server only. One fetch per six hours; any failure gives no bars (the chart is then not drawn). */
export async function loadRevenueHistory(ticker: string, now = Date.now()): Promise<HistoryQuarter[]> {
  const cik = CIK[ticker];
  if (!cik) return [];
  if (cache && cache.ticker === ticker && now - cache.at < 6 * 3_600_000) return cache.series;
  try {
    const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/json", "User-Agent": process.env.RESEARCH_USER_AGENT || "TechPhaseResearch/1.0 research-preview" } });
    if (!response.ok) return cache?.series ?? [];
    const series = quarterlyRevenue(await response.json());
    cache = { at: now, ticker, series };
    return series;
  } catch { return cache?.series ?? []; }
}
