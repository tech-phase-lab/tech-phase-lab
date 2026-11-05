/** Day dividers for the home news list (owner, Nov 5): "今日", "昨日", then "11月3日"; days are Japan time. */
const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" });

/** The Japan-time date ("2026-11-05") a list entry belongs to. A source that states only a date keeps that date. */
export function dayKey(at: string, kind: "date" | "time") {
  return kind === "date" ? at.slice(0, 10) : day.format(new Date(at));
}

export function dayLabel(key: string, now: number, ja: boolean) {
  const today = day.format(new Date(now));
  const yesterday = day.format(new Date(now - 24 * 3_600_000));
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
