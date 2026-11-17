import type { Language } from "./data";
import { formatDisplay } from "./display-time.ts";

export function formatTargetTime(date: string, lang: Language, compact = false) {
  return formatDisplay(date, lang, {
    ...(compact ? {} : { month: "short", day: "numeric" } as const),
    hour: "2-digit", minute: "2-digit", hour12: false,
    ...(compact ? {} : { timeZoneName: "short" } as const),
  });
}
