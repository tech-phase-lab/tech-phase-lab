import { displayDayKey, type DisplayLang } from "./display-time.ts";

/** Day dividers for the home news list (owner, Nov 5): "今日", "昨日", then "11月3日". Days are Japan time
 * on the Japanese site and U.S. Eastern time on the English site (owner, Nov 17). */

/** The date ("2026-11-05") a list entry belongs to in the site's zone. A source that states only a date keeps that date. */
export function dayKey(at: string, kind: "date" | "time", lang: DisplayLang) {
  return kind === "date" ? at.slice(0, 10) : displayDayKey(at, lang);
}

export function dayLabel(key: string, now: number, ja: boolean) {
  const today = displayDayKey(now, ja ? "ja" : "en");
  // The calendar day before today's (stepping from noon UTC of the key, so a 23- or 25-hour DST day cannot skip one).
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 24 * 3_600_000).toISOString().slice(0, 10);
  if (key === today) return ja ? "今日" : "Today";
  if (key === yesterday) return ja ? "昨日" : "Yesterday";
  const [, month, date] = key.split("-").map(Number);
  return ja ? `${month}月${date}日` : new Date(Date.UTC(2000, month - 1, date)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Group the entries of one page by day, newest first as given; a divider goes before the first entry of each day. */
export function withDayDividers<T extends { dayKey: string }>(entries: readonly T[]) {
  let previous = "";
  return entries.map(entry => { const divider = entry.dayKey !== previous ? entry.dayKey : null; previous = entry.dayKey; return { entry, divider }; });
}

/** Five stories per page. `cap` limits how many the list shows at all (the home list: 25, five pages). */
export function pageWindow(count: number, page: number, cap = Infinity) {
  const total = Math.min(count, cap);
  const pages = Math.max(1, Math.ceil(total / 5));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * 5;
  return { total, pages, current, start, end: Math.min(start + 5, total) };
}
