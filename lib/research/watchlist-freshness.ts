import type { FavoriteQuote } from "./favorite-lists.ts";

// Display guardrails, not an exchange calendar or a provider outage diagnosis.
// Revisit these tolerances against the licensed feed cadence before connecting it.
const MINUTE = 60_000;
export type QuoteFreshness = "unknown" | "invalid" | "recent" | "delayed" | "stale" | "closed";
export function quoteFreshness(quote: Pick<FavoriteQuote, "asOf" | "session" | "delayed">, now: number | null): QuoteFreshness {
  const at = Date.parse(quote.asOf);
  if (!Number.isFinite(at)) return "invalid";
  if (now === null || !Number.isFinite(now)) return "unknown";
  if (at > now + MINUTE) return "invalid";
  // A confirmed close remains a dated close across weekends and holidays.
  if (quote.session === "closed") return "closed";
  if (now - at > (quote.delayed ? 20 : 5) * MINUTE) return "stale";
  return quote.delayed ? "delayed" : "recent";
}
export function freshnessLabel(state: QuoteFreshness, lang: "ja" | "en") {
  const labels = { unknown: ["", ""], invalid: ["時刻未確認", "Time unverified"], recent: ["", ""], delayed: ["遅延", "Delayed"], stale: ["最終取得", "Last available"], closed: ["終値", "Close"] };
  return labels[state][lang === "ja" ? 0 : 1];
}
export function quoteTimeText(asOf: string, now: number | null, lang: "ja" | "en" = "ja") {
  const at = Date.parse(asOf);
  if (!Number.isFinite(at)) return "—";
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
  const showDate = now === null || !Number.isFinite(now) || day.format(at) !== day.format(now);
  const clock = new Date(at).toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
  const date = new Date(at).toLocaleDateString(lang === "ja" ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", month: lang === "ja" ? "numeric" : "short", day: "numeric", ...(now === null || !Number.isFinite(now) || day.format(at).slice(0, 4) !== day.format(now).slice(0, 4) ? { year: "numeric" } as const : {}) });
  return `${showDate ? date + " " : ""}${clock} JST`;
}
