/** おやすみモード / Quiet hours (owner, Nov 17): the English site shows US Eastern Time everywhere, so a device's quiet hours are
 * kept with their zone. The Japanese screen saves Japan time, the English one ET; the monitor reads the hours in the stored zone
 * (scripts/research/web_push.py quiet_blocks, with daylight saving time). Settings saved before Nov 17 carry no zone: Japan time. */
export type QuietZone = "Asia/Tokyo" | "America/New_York";
export type QuietHours = { on: boolean; start: number; end: number; zone?: QuietZone };

export const QUIET_ZONES: readonly QuietZone[] = ["Asia/Tokyo", "America/New_York"];

/** The zone a language's screen shows and saves: ET on the English site, Japan time on the Japanese one. */
export const quietZoneFor = (lang: "ja" | "en"): QuietZone => lang === "en" ? "America/New_York" : "Asia/Tokyo";

/** The stored zone; a setting without one (or with an unknown one) is Japan time. */
export const storedQuietZone = (quiet: QuietHours): QuietZone => quiet.zone && QUIET_ZONES.includes(quiet.zone) ? quiet.zone : "Asia/Tokyo";

const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Minutes a zone is ahead of UTC at a moment. */
function offsetMinutes(zone: QuietZone, at: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(at).filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
  return (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000;
}

/** An hour on the clock in one zone, as the hour on the clock in another at the given moment (Japan and New York are 13 or 14 hours apart). */
export function convertHour(h: number, from: QuietZone, to: QuietZone, at = new Date()) {
  if (from === to) return h;
  const shift = Math.round((offsetMinutes(to, at) - offsetMinutes(from, at)) / 60);
  return ((h + shift) % 24 + 24) % 24;
}

/** The hours as the screen in this language edits them: in its own zone, converted from the stored zone when they differ. */
export function quietDraft(quiet: QuietHours, lang: "ja" | "en", at = new Date()): Required<QuietHours> {
  const from = storedQuietZone(quiet), zone = quietZoneFor(lang);
  return { on: quiet.on, start: convertHour(quiet.start, from, zone, at), end: convertHour(quiet.end, from, zone, at), zone };
}

/** What a save sends. The Japanese screen sends no zone (the monitor reads that as Japan time, as before Nov 17); the English one sends ET. */
export function quietToSave(draft: Required<QuietHours>): QuietHours {
  const { zone, ...hours } = draft;
  return zone === "Asia/Tokyo" ? hours : draft;
}

/** The hours in their stored zone, with the zone named when it is not the one this language's screen uses by default. */
export function quietLabel(quiet: QuietHours, lang: "ja" | "en") {
  if (!quiet.on) return lang === "ja" ? "オフ" : "Off";
  const zone = storedQuietZone(quiet);
  if (lang === "ja") return `${hour(quiet.start)}〜${hour(quiet.end)}${zone === "Asia/Tokyo" ? "" : "（米国東部時間）"}`;
  return `${hour(quiet.start)}–${hour(quiet.end)} ${zone === "Asia/Tokyo" ? "JST" : "ET"}`;
}
