/** "12月5日": a day in Japan time, month and day only. Used for the day PRO ends, taken from the real contract. */
export function monthDay(iso: string | null | undefined, ja: boolean) {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).formatToParts(ms);
  const month = Number(parts.find(p => p.type === "month")?.value), day = Number(parts.find(p => p.type === "day")?.value);
  return ja ? `${month}月${day}日` : new Date(Date.UTC(2000, month - 1, day)).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}
