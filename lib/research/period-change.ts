/** A stock page's "change over the chosen period" line (owner, Nov 13): the price against the close of the day the period reaches back to
 * (a market holiday falls back to the trading day before it); year to date against the last close of the previous year. No server-only
 * imports so it can be tested directly. */
export type ChangePeriod = "1w" | "1m" | "6m" | "1y" | "ytd" | "5y";
export const CHANGE_PERIODS: readonly ChangePeriod[] = ["1w", "1m", "6m", "1y", "ytd", "5y"];
export const isChangePeriod = (value: unknown): value is ChangePeriod => typeof value === "string" && (CHANGE_PERIODS as readonly string[]).includes(value);
export type PeriodBase = { date: string; close: number };

const pad = (n: number) => String(n).padStart(2, "0");
/** `today` (YYYY-MM-DD) moved back by the period; a month end that does not exist becomes that month's last day (3/31 − 1 month = 2/28). */
export function targetDate(period: Exclude<ChangePeriod, "ytd">, today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  if (period === "1w") { const t = new Date(Date.UTC(y, m - 1, d - 7)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; }
  const months = period === "1m" ? 1 : period === "6m" ? 6 : period === "1y" ? 12 : 60;
  const total = y * 12 + (m - 1) - months, year = Math.floor(total / 12), month = total % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${pad(month + 1)}-${pad(Math.min(d, last))}`;
}

/** The close each period is measured from, out of daily closes (any order, `at` starting YYYY-MM-DD). Null when the series does not reach
 * back that far (a recent listing, or a short answer): the line is then not shown. */
export function periodBase(closes: { at: string; close: number }[], period: ChangePeriod, today: string): PeriodBase | null {
  const bound = period === "ytd" ? `${Number(today.slice(0, 4)) - 1}-12-31` : targetDate(period, today);
  const days = closes.map(c => ({ date: c.at.slice(0, 10), close: c.close })).filter(c => /^\d{4}-\d{2}-\d{2}$/.test(c.date) && Number.isFinite(c.close) && c.close > 0).sort((a, b) => a.date < b.date ? -1 : 1);
  if (!days.length || days[0].date > bound) return null;
  let found: PeriodBase | null = null;
  for (const day of days) { if (day.date > bound) break; found = day; }
  // A gap of more than ten days before the bound means the series has a hole there; do not guess.
  if (found && (Date.parse(bound) - Date.parse(found.date)) / 86_400_000 > 10) return null;
  return found;
}
export function periodBases(closes: { at: string; close: number }[], today: string): Partial<Record<ChangePeriod, PeriodBase>> {
  const out: Partial<Record<ChangePeriod, PeriodBase>> = {};
  for (const period of CHANGE_PERIODS) { const base = periodBase(closes, period, today); if (base) out[period] = base; }
  return out;
}
export const periodPercent = (price: number, base: PeriodBase) => Number.isFinite(price) && price > 0 ? (price / base.close - 1) * 100 : null;
/** "5/13 845.99 から" (a date in an earlier year keeps its year: "2021/11/12"), "前年末 573.70 から" for year to date. */
export function baseText(period: ChangePeriod, base: PeriodBase, today: string, ja: boolean) {
  const price = base.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (period === "ytd") return ja ? `前年末 ${price} から` : `from ${price} at last year's close`;
  const [y, m, d] = base.date.split("-").map(Number);
  const date = y === Number(today.slice(0, 4)) ? `${m}/${d}` : `${y}/${m}/${d}`;
  return ja ? `${date} ${price} から` : `from ${price} on ${date}`;
}
