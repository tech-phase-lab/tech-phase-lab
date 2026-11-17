import { displayParts } from "./display-time.ts";

/** "12月5日" / "December 5": a day, month and day only, in Japan time on the Japanese site and U.S. Eastern time on the English
 * site (owner, Nov 17). Used for the day PRO ends, taken from the real contract. */
export function monthDay(iso: string | null | undefined, ja: boolean) {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return null;
  const parts = displayParts(ms, ja ? "ja" : "en", { month: "numeric", day: "numeric" }, "en-US");
  const month = Number(parts.find(p => p.type === "month")?.value), day = Number(parts.find(p => p.type === "day")?.value);
  return ja ? `${month}月${day}日` : new Date(Date.UTC(2000, month - 1, day)).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}
