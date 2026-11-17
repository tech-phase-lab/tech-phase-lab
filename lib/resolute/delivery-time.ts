import { displayParts, zoneLabel, type DisplayLang } from "../research/display-time.ts";

/**
 * RESOLUTE alerts are sent at a fixed hour in Japan time (settings.deliveryHourJst, 7–10).
 * Owner decision (Nov 17, 案A): the sending moments stay the same, but the English site
 * shows each one in U.S. Eastern time ("5:00 PM ET" in winter, "6:00 PM ET" in summer, on
 * the previous U.S. day). Display only: nothing new is stored.
 */

const HOUR = 3_600_000;
const JST_OFFSET_HOURS = 9; // Japan has no daylight saving.

/** The next instant (at or after `now`) at which it is `hourJst`:00 in Japan. */
export function nextDeliveryInstant(hourJst: number, now: number | Date = Date.now()) {
  const at = now instanceof Date ? now.getTime() : now;
  const jst = new Date(at + JST_OFFSET_HOURS * HOUR);
  const today = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), hourJst - JST_OFFSET_HOURS);
  return new Date(today >= at ? today : today + 24 * HOUR);
}

/** The time alone, for buttons: "7:00" in Japanese, "5:00 PM" (Eastern, DST-correct) in English. */
export function deliveryClock(hourJst: number, lang: DisplayLang, now: number | Date = Date.now()) {
  if (lang === "ja") return `${hourJst}:00`;
  // Built from parts so every engine prints the same plain space before AM/PM (no hydration drift).
  const parts = displayParts(nextDeliveryInstant(hourJst, now), "en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const hour = Number(parts.find(part => part.type === "hour")?.value);
  const minute = parts.find(part => part.type === "minute")?.value ?? "00";
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

/** The zone word after the time: 日本時間 in Japanese, ET in English. */
export const deliveryZone = (lang: DisplayLang) => lang === "ja" ? "日本時間" : zoneLabel("en");

/** The time with its zone: "7:00 日本時間" / "5:00 PM ET". */
export function deliveryLabel(hourJst: number, lang: DisplayLang, now: number | Date = Date.now()) {
  return `${deliveryClock(hourJst, lang, now)} ${deliveryZone(lang)}`;
}
