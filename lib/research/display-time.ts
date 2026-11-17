/**
 * Display time zones (owner, Nov 17): every date and time the English site shows is
 * U.S. Eastern time, labelled "ET" (America/New_York, so EST/EDT follow the calendar);
 * the Japanese site shows Japan time, labelled "JST". Display only: cutoffs, schedules
 * and other server-side rules keep their own zones.
 *
 * Every user-visible formatter goes through here so the two sites cannot drift apart
 * again (tests/display-time.test.mjs scans app/ and lib/ for formatting that bypasses it).
 */
export type DisplayLang = "ja" | "en";
type When = string | number | Date;

export const JAPAN_ZONE = "Asia/Tokyo";
export const EASTERN_ZONE = "America/New_York";

/** The IANA zone a language's site displays times in. */
export const zoneFor = (lang: DisplayLang) => lang === "ja" ? JAPAN_ZONE : EASTERN_ZONE;
/** The short label shown after a time: "JST" or "ET". */
export const zoneLabel = (lang: DisplayLang) => lang === "ja" ? "JST" : "ET";
/** The default locale for a language's dates. */
export const localeFor = (lang: DisplayLang) => lang === "ja" ? "ja-JP" : "en-US";

const cache = new Map<string, Intl.DateTimeFormat>();
/** An Intl formatter in the language's display zone. `locale` overrides the language's own (e.g. "en-GB" for a 24-hour "HH:MM"). */
export function displayFormatter(lang: DisplayLang, options: Intl.DateTimeFormatOptions = {}, locale = localeFor(lang)) {
  const key = `${lang}|${locale}|${JSON.stringify(options)}`;
  let format = cache.get(key);
  if (!format) { format = new Intl.DateTimeFormat(locale, { ...options, timeZone: zoneFor(lang) }); cache.set(key, format); }
  return format;
}

const toDate = (value: When) => value instanceof Date ? value : new Date(value);

/** Format an instant in the language's display zone. */
export function formatDisplay(value: When, lang: DisplayLang, options: Intl.DateTimeFormatOptions = {}, locale?: string) {
  return displayFormatter(lang, options, locale).format(toDate(value));
}

/** Parts of an instant in the language's display zone. */
export function displayParts(value: When, lang: DisplayLang, options: Intl.DateTimeFormatOptions = {}, locale?: string) {
  return displayFormatter(lang, options, locale).formatToParts(toDate(value));
}

/** "21:05": a 24-hour clock in the language's display zone. */
export function displayClock(value: When, lang: DisplayLang, seconds = false) {
  return formatDisplay(value, lang, { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } as const : {}), hourCycle: "h23" }, "en-GB");
}

/** The calendar day ("2026-11-05") an instant falls on in the language's display zone. */
export function displayDayKey(value: When, lang: DisplayLang) {
  return formatDisplay(value, lang, {}, "sv-SE");
}

/** A full date and time with the zone label: "2026/11/5 9:05:00 JST" / "11/4/2026, 19:05:00 ET". */
export function displayDateTime(value: When, lang: DisplayLang) {
  return `${formatDisplay(value, lang, { year: "numeric", month: "numeric", day: "numeric", hour: lang === "ja" ? "numeric" : "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })} ${zoneLabel(lang)}`;
}
