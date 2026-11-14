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

/** What the market-board banner says: pre-market, regular trading, after-hours, or closed (weekends and holidays included).
 * Decided on New York time, so daylight saving needs no fixed Tokyo hours. Outside the holiday calendar the weekday and the clock decide. */
export type MarketPhase = "pre" | "regular" | "post" | "closed";
export function marketPhase(at: Date): MarketPhase {
  const known = usMarketSession(at);
  if (known === "pre" || known === "regular" || known === "post") return known;
  if (known !== null) return "closed";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(at).map(part => [part.type, part.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return "closed";
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 570 && minutes < 960 ? "regular" : minutes >= 240 && minutes < 570 ? "pre" : minutes >= 960 && minutes < 1200 ? "post" : "closed";
}
/** "取引中 ・ 06:20 JST" parts: the state word (Japanese / English) and whether the mint point is lit. */
export function marketBanner(phase: MarketPhase): { ja: string; en: string; lit: boolean } {
  return phase === "pre" ? { ja: "プレ取引中", en: "Pre-market", lit: true } : phase === "regular" ? { ja: "取引中", en: "Open", lit: true }
    : phase === "post" ? { ja: "アフター取引中", en: "After-hours", lit: true } : { ja: "取引終了", en: "Closed", lit: false };
}
/** "取引中 ・ 06:20:35 JST": the state word and the time (to the second, Japan time) of the last successful read; no time before the first one. */
export function bannerLine(phase: MarketPhase, ja: boolean, fetchedAt: number | null): string {
  const word = marketBanner(phase)[ja ? "ja" : "en"];
  if (fetchedAt === null) return word;
  const time = new Date(fetchedAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return `${word}${ja ? " ・ " : " · "}${time} JST`;
}
