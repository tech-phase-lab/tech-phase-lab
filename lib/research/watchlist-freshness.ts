import type { FavoriteQuote } from "./favorite-lists.ts";
import { displayClock, displayDayKey, formatDisplay, zoneLabel } from "./display-time.ts";
import { marketPhase } from "./us-market-session.ts";
const easternDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

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
  // A pre-market / after-hours price keeps its "プレ" / "時間外" label for as long as that session is the one under way the same day, however old
  // its print (owner, Nov 25: MRVL, GOOGL); the server already dropped it if that session is over. Regular-session prices keep the 5-minute check.
  if (!quote.delayed && (quote.session === "pre" || quote.session === "post"))
    return marketPhase(new Date(now)) === quote.session && easternDay.format(at) === easternDay.format(now) ? "recent" : "stale";
  const tolerance = quote.delayed ? 20 : 5;
  if (now - at > tolerance * MINUTE) return "stale";
  return quote.delayed ? "delayed" : "recent";
}
export function freshnessLabel(state: QuoteFreshness, lang: "ja" | "en") {
  const labels = { unknown: ["", ""], invalid: ["時刻未確認", "Time unverified"], recent: ["", ""], delayed: ["遅延", "Delayed"], stale: ["最終取得", "Last available"], closed: ["終値", "Close"] };
  return labels[state][lang === "ja" ? 0 : 1];
}
/** The quote's time: Japan time ("JST") in Japanese, U.S. Eastern ("ET") in English (owner, Nov 17); the date only when it is not today there. */
export function quoteTimeText(asOf: string, now: number | null, lang: "ja" | "en") {
  const at = Date.parse(asOf);
  if (!Number.isFinite(at)) return "—";
  const day = (value: number) => displayDayKey(value, lang);
  const showDate = now === null || !Number.isFinite(now) || day(at) !== day(now);
  const clock = displayClock(at, lang);
  const date = formatDisplay(at, lang, { month: lang === "ja" ? "numeric" : "short", day: "numeric", ...(now === null || !Number.isFinite(now) || day(at).slice(0, 4) !== day(now).slice(0, 4) ? { year: "numeric" } as const : {}) });
  return `${showDate ? date + " " : ""}${clock} ${zoneLabel(lang)}`;
}
