/** The share price move after a results release, from the provider's own quote fields only (nothing inferred). Cause is never stated here. */
export type ReactionQuote = {
  price: number; percentChange: number | null; asOf: string; session: "regular" | "pre" | "post" | "closed";
  extended?: { price: number; percentChange: number; asOf: string; session: "pre" | "post" };
};
export type ReactionLine = { label: string; labelEn: string; percent: number; at: string; base: string; baseEn: string };

/** Only moves stamped at or after the release count: an earlier stamp is the pre-release price. Returns [] when nothing qualifies. */
export function reactionLines(quote: ReactionQuote | null | undefined, releasedAt: string): ReactionLine[] {
  const since = Date.parse(releasedAt);
  if (!quote || !Number.isFinite(since)) return [];
  const out: ReactionLine[] = [];
  // A line without its value is not shown (owner, Nov 27).
  if (typeof quote.percentChange === "number" && Number.isFinite(quote.percentChange) && Date.parse(quote.asOf) >= since) out.push({ label: "通常取引", labelEn: "Regular session", percent: quote.percentChange, at: quote.asOf, base: "前日終値比", baseEn: "vs. previous close" });
  const x = quote.extended;
  // A pre-market / after-hours move of ±0.00% is left out, as on the market board (owner, Nov 27).
  if (x && typeof x.percentChange === "number" && Number.isFinite(x.percentChange) && Math.abs(x.percentChange) >= 0.005 && Date.parse(x.asOf) >= since) out.push({ label: x.session === "pre" ? "プレマーケット" : "時間外", labelEn: x.session === "pre" ? "Pre-market" : "After hours", percent: x.percentChange, at: x.asOf, base: "通常取引の終値比", baseEn: "vs. regular-session close" });
  return out;
}
export const percentText = (p: number) => `${p >= 0 ? "+" : "-"}${Math.abs(p).toFixed(2)}%`;

const nyParts = (at: string) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" })
  .formatToParts(new Date(at)).map(part => [part.type, part.value]));
/** Which session a regular-session move belongs to (owner, Nov 28: 「翌日の株価」): "next" when it is the first weekday session after a
 * release made after the close (or on a weekend), "same" for a release before or during that day's session, "later" for any later
 * day (named by its date instead). Market holidays are not assumed: a session after one is "later". */
export function reactionDay(quoteAt: string, releasedAt: string): "same" | "next" | "later" | null {
  if (!Number.isFinite(Date.parse(quoteAt)) || !Number.isFinite(Date.parse(releasedAt))) return null;
  const r = nyParts(releasedAt), q = nyParts(quoteAt);
  const day = (p: Record<string, string>) => `${p.year}-${p.month}-${p.day}`;
  const weekend = r.weekday === "Sat" || r.weekday === "Sun";
  if (!weekend && Number(r.hour) < 16) return day(q) === day(r) ? "same" : "later";
  // the first weekday after the release day
  let next = Date.parse(`${day(r)}T12:00:00Z`) + 86_400_000;
  while ([0, 6].includes(new Date(next).getUTCDay())) next += 86_400_000;
  return day(q) === new Date(next).toISOString().slice(0, 10) ? "next" : "later";
}
