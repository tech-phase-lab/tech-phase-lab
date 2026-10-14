/** U.S. stock market session from the clock and the NYSE holiday calendar.
 * The calendar below covers 2026 and 2027 only; outside it the session is
 * unknown (null) rather than guessed. Verify and extend it each December. */
export type MarketSession = "regular" | "pre" | "post" | "closed" | "holiday";

const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
/** Regular session ends at 13:00 on these days. */
const EARLY_CLOSE = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);

export function usMarketSession(at: Date): MarketSession | null {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(at).map(part => [part.type, part.value]));
  const year = Number(parts.year);
  if (year < 2026 || year > 2027) return null;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return "closed";
  if (HOLIDAYS.has(date)) return "holiday";
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const close = EARLY_CLOSE.has(date) ? 13 * 60 : 16 * 60;
  if (minutes >= 9 * 60 + 30 && minutes < close) return "regular";
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "pre";
  if (minutes >= close && minutes < (EARLY_CLOSE.has(date) ? 17 * 60 : 20 * 60)) return "post";
  return "closed";
}
