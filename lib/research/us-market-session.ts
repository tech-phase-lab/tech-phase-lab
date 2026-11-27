import { displayClock, zoneLabel } from "./display-time.ts";
/** U.S. stock market session from the clock and the NYSE holiday calendar.
 * The calendar below covers 2026 and 2027 only; outside it the session is
 * unknown (null) rather than guessed. Verify and extend it each December. */
export type MarketSession = "regular" | "pre" | "post" | "closed" | "holiday";

/** NYSE full-day holidays and their names (Japanese / English); an observed day carries the holiday's own name. */
export const US_MARKET_HOLIDAYS: Readonly<Record<string, { ja: string; en: string }>> = Object.freeze({
  "2026-01-01": { ja: "元日", en: "New Year's Day" }, "2026-01-19": { ja: "キング牧師記念日", en: "Martin Luther King Jr. Day" },
  "2026-02-16": { ja: "大統領の日", en: "Presidents' Day" }, "2026-04-03": { ja: "聖金曜日", en: "Good Friday" },
  "2026-05-25": { ja: "戦没将兵追悼記念日", en: "Memorial Day" }, "2026-06-19": { ja: "ジューンティーンス", en: "Juneteenth" },
  "2026-07-03": { ja: "独立記念日", en: "Independence Day" }, "2026-09-07": { ja: "労働者の日", en: "Labor Day" },
  "2026-11-26": { ja: "感謝祭", en: "Thanksgiving" }, "2026-12-25": { ja: "クリスマス", en: "Christmas" },
  "2027-01-01": { ja: "元日", en: "New Year's Day" }, "2027-01-18": { ja: "キング牧師記念日", en: "Martin Luther King Jr. Day" },
  "2027-02-15": { ja: "大統領の日", en: "Presidents' Day" }, "2027-03-26": { ja: "聖金曜日", en: "Good Friday" },
  "2027-05-31": { ja: "戦没将兵追悼記念日", en: "Memorial Day" }, "2027-06-18": { ja: "ジューンティーンス", en: "Juneteenth" },
  "2027-07-05": { ja: "独立記念日", en: "Independence Day" }, "2027-09-06": { ja: "労働者の日", en: "Labor Day" },
  "2027-11-25": { ja: "感謝祭", en: "Thanksgiving" }, "2027-12-24": { ja: "クリスマス", en: "Christmas" },
});
// The same dates as US_MARKET_HOLIDAYS, kept as a literal list: the Python price-alert calendar test reads it from this file.
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
/** "取引中 ・ 06:20:35 JST" / "Open · 16:20:35 ET": the state word and a running clock (to the second; Japan time in Japanese, U.S. Eastern in English,
 * owner Nov 17). `clockAt` is the current time, ticking every second on the page (owner, Nov 24: the time stood still at the last read); no time before
 * the page has a clock. How old the prices are is said separately (freshnessNote), never by stopping the clock. */
export function bannerLine(phase: MarketPhase, ja: boolean, clockAt: number | null): string {
  const lang = ja ? "ja" : "en";
  const word = marketBanner(phase)[lang];
  if (clockAt === null) return word;
  return `${word}${ja ? " ・ " : " · "}${displayClock(clockAt, lang, true)} ${zoneLabel(lang)}`;
}
/** The board reads its prices every 15 seconds; a read older than this means the updates have stopped (provider or network trouble). */
export const BOARD_STALE_MS = 60_000;
/** "株価 22:23:50 時点の取得" / "prices as of 08:23:50": shown next to the running clock only when the last successful read is older than
 * BOARD_STALE_MS, so a stopped feed is never hidden behind a moving clock. null while the prices are current, or before the first read. */
export function freshnessNote(ja: boolean, fetchedAt: number | null, now: number | null): string | null {
  if (fetchedAt === null || now === null || now - fetchedAt < BOARD_STALE_MS) return null;
  const lang = ja ? "ja" : "en";
  return ja ? `株価は ${displayClock(fetchedAt, lang, true)} 時点（更新が止まっています）` : `prices as of ${displayClock(fetchedAt, lang, true)} (updates paused)`;
}

/** The U.S. trading day whose close the board shows while the market is shut for the day (owner, Nov 15): from 00:00 New York time on a Saturday,
 * a Sunday or an NYSE holiday until the next trading day's pre-market starts at 04:00 (so Monday 00:00–04:00 still reads as closed).
 * null otherwise, including a weekday evening after the after-hours session, which keeps the usual banner. Outside the holiday calendar only weekends count. */
export type ClosedDay = { month: number; day: number; weekday: number };
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function newYorkDay(at: Date): { date: string; weekday: number; minutes: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(at).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: WEEKDAYS.indexOf(parts.weekday), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
/** A New York calendar date ("2026-11-13", read as UTC noon so steps of a day never slip) is a trading day: a weekday that is not a listed holiday. */
const tradingDate = (noon: number) => { const d = new Date(noon), weekday = d.getUTCDay(); return weekday !== 0 && weekday !== 6 && !HOLIDAYS.has(d.toISOString().slice(0, 10)); };
export function closedDayClose(at: Date): ClosedDay | null {
  const now = newYorkDay(at), noon = Date.parse(`${now.date}T12:00:00Z`);
  if (tradingDate(noon) && (now.minutes >= 4 * 60 || tradingDate(noon - DAY_MS))) return null;
  let day = noon - DAY_MS;
  while (!tradingDate(day)) day -= DAY_MS;
  const d = new Date(day);
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}
/** "休場 ・ 米国 11/13(金) の終値" / "Closed · U.S. close of Fri 11/13": no read time while the market is shut for the day. */
export function closedDayLine(close: ClosedDay, ja: boolean): string {
  const date = `${close.month}/${close.day}`;
  return ja ? `休場 ・ 米国 ${date}(${"日月火水木金土"[close.weekday]}) の終値` : `Closed · U.S. close of ${WEEKDAYS[close.weekday]} ${date}`;
}

/** The home notice wording on a day the U.S. market is closed (owner, Nov 27; the exact words are the owner's to change, here only):
 * a weekend gets the plain line, an NYSE holiday the line with its name ({name}). */
export const MARKET_CLOSED_NOTICE = {
  weekend: { ja: "本日の米国市場はお休みです。", en: "U.S. markets are closed today." },
  holiday: { ja: "本日は{name}のため、米国市場はお休みです。", en: "U.S. markets are closed today for {name}." },
} as const;
/** Holidays whose notice gives no name (owner, Nov 27: Memorial Day): the plain line, as on a weekend. */
const NOTICE_WITHOUT_NAME = new Set(Object.entries(US_MARKET_HOLIDAYS).filter(([, h]) => h.en === "Memorial Day").map(([d]) => d));
/** The notice for `at`, or null on a trading day. "Today" is the U.S. Eastern calendar date: a Saturday, a Sunday, or an NYSE holiday of
 * the 2026–2027 calendar (outside the calendar only weekends are known). */
export function marketClosedNotice(at: Date, lang: "ja" | "en"): string | null {
  if (!Number.isFinite(at.getTime())) return null;
  const { date, weekday } = newYorkDay(at);
  if (weekday === 0 || weekday === 6 || NOTICE_WITHOUT_NAME.has(date)) return MARKET_CLOSED_NOTICE.weekend[lang];
  const holiday = US_MARKET_HOLIDAYS[date];
  return holiday ? MARKET_CLOSED_NOTICE.holiday[lang].replace("{name}", holiday[lang]) : null;
}
