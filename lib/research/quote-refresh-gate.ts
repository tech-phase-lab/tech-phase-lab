/** The watchlist's 15-second price refresh (owner, Nov 13) and the guard that keeps it inside the shared Twelve Data plan.
 * The plan allows 610 credits a minute for everything (prices, the market board, comparisons, alerts, monitoring); a quote costs one credit
 * per symbol. A 15-second refresh spends up to four credits a minute per symbol being looked at instead of one, so the extra reads are taken
 * only while the minute's usage leaves room; otherwise the quote is kept a minute, as before. No server-only / Next imports so it can be tested. */

export const QUOTE_TTL_MS = 60_000;
export const FAST_QUOTE_TTL_MS = 15_000;
export const PLAN_CREDITS_PER_MINUTE = 610;
/** Credits used this minute (all of the plan's users) + the extra reads' cost must stay at or under this; the rest is left to the other features. */
export const FAST_REFRESH_BUDGET = 200;

/** The tickers to read now. `ages` holds each wanted ticker's cache age in ms (Infinity when never read). Older than a minute: always read.
 * Between 15 seconds and a minute: read only when `allowFast` says the minute's usage leaves room for them. */
export function quotesToRead(ages: Record<string, number>, fast: boolean, allowFast: (extra: number) => boolean): { read: string[]; fast: boolean } {
  const due = Object.keys(ages).filter(t => !(ages[t] < QUOTE_TTL_MS));
  if (!fast) return { read: due, fast: false };
  const optional = Object.keys(ages).filter(t => ages[t] >= FAST_QUOTE_TTL_MS && ages[t] < QUOTE_TTL_MS);
  if (!optional.length) return { read: due, fast: true };
  return allowFast(optional.length) ? { read: [...due, ...optional], fast: true } : { read: due, fast: false };
}

/** True when the reads fit: `used` is the minute's usage (null when the meter could not be read, then the reads wait for the next minute's room). */
export const fitsBudget = (used: number | null, cost: number, budget = FAST_REFRESH_BUDGET) =>
  used !== null && Number.isFinite(used) && used >= 0 && used + cost <= budget;

/** This process's own spending over the last minute: a floor for the usage when the provider's meter is older than the reads since. */
export function creditWindow(now: () => number = Date.now) {
  const spent: { at: number; credits: number }[] = [];
  const prune = () => { const from = now() - 60_000; while (spent.length && spent[0].at <= from) spent.shift(); };
  return {
    record(credits: number) { if (credits > 0) { spent.push({ at: now(), credits }); prune(); } },
    total() { prune(); return spent.reduce((sum, item) => sum + item.credits, 0); },
  };
}

/** Parses /api_usage; null when the answer is not the expected shape. */
export const parseUsage = (body: unknown): number | null => {
  const used = body && typeof body === "object" ? (body as { current_usage?: unknown }).current_usage : undefined;
  return typeof used === "number" && Number.isFinite(used) && used >= 0 ? used : null;
};
