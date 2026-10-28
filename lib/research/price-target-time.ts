import type { Language } from "./data";

export function formatTargetTime(date: string, lang: Language, compact = false) {
  return new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", {
    timeZone: lang === "ja" ? "Asia/Tokyo" : "America/New_York",
    ...(compact ? {} : { month: "short", day: "numeric", second: "2-digit" } as const),
    hour: "2-digit", minute: "2-digit", hour12: false,
    ...(compact ? {} : { timeZoneName: "short" } as const),
  }).format(new Date(date));
}
