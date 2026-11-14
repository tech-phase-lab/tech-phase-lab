import type { CalendarEvent } from "./calendar";

const PATTERN = /^(.+?) ?決算(説明会|発表)（(?:\d{4}年度?)?(.+?)）$/;

/** Short Japanese earnings titles for the calendar list: "NVIDIA Q3決算" instead of "NVIDIA 決算説明会（2027年度Q3）", which ran to two
 * lines (owner, Nov 14). A company with both a release and a call for the same quarter (ASML) keeps "決算説明会" on the call so the two rows
 * stay distinct. Other events and the English titles are unchanged; the full title stays in the event's details. */
export function shortCalendarTitle(event: CalendarEvent, all: readonly CalendarEvent[], lang: "ja" | "en"): string {
  const full = event.title[lang];
  if (lang !== "ja" || event.kind !== "earnings") return full;
  const m = PATTERN.exec(full);
  if (!m) return full;
  const [, name, kind, period] = m;
  const sibling = kind === "説明会" && all.some(other => other !== event && other.ticker === event.ticker
    && PATTERN.exec(other.title.ja)?.[2] === "発表" && PATTERN.exec(other.title.ja)?.[3] === period);
  return `${name}${name.endsWith("）") ? "" : " "}${period}決算${sibling ? "説明会" : ""}`;
}
