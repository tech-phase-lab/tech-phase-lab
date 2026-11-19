/** How the comparison's provider data is spread over the day so its cost never grows with the number of users (owner, Nov 15: "全部やって").
 * No server-only / Next imports so it can be tested directly.
 *
 * Plan limit: 610 credits per minute, shared by the whole site (prices, alerts, the thermometer, monitoring; 1–2 credits a minute when idle).
 * Costs per symbol (twelvedata.com/docs, Nov 15): statistics 50, income_statement 100, cash_flow 100, time_series 1, api_usage 1.
 *
 * - A user's comparison never calls statistics or statements. It reads what the background job stored, the free SEC filing, and at most one
 *   one-credit price series per company (only while the minute has plenty of room, never waiting).
 * - The background job takes every US-listed company (Nasdaq, NYSE, Cboe, TXSE; one ticker per company, about 6,460) once a day: minute m of
 *   the day takes the companies at positions m, m + 1440, m + 2880, ... (5 of them), statistics and price series each: 5 × 51 = 255 credits.
 * - The statements (200 credits) are read only for a company whose filing cannot give every figure (IFRS, 20-F/6-K, a missing quarter or
 *   factor), once a week, in that company's own minute, and only while the minute stays under the job's ceiling. */

export const PLAN_CREDITS_PER_MINUTE = 610;
export const COST = { statistics: 50, statements: 200, series: 1, usage: 1 } as const;
/** The background job sends a call only while the minute's usage plus the call stays at or under this (leaves 150 for the rest of the site). */
export const WARM_CEILING = 460;
/** A read started after a user's comparison missed the cache (in the background, after the answer was sent): only with this much room. */
export const BACKGROUND_CEILING = 400;
/** A user's one-credit price series: only while the minute is under this. */
export const USER_SERIES_CEILING = 560;
export const MINUTES_PER_DAY = 1440;

const DAY = 86_400_000;
export const daySlot = (now: number) => Math.floor(now / DAY);
export const hourSlot = (now: number) => Math.floor(now / 3_600_000);
export const weekSlot = (now: number) => Math.floor(now / (7 * DAY));
export const minuteOfDay = (now: number) => Math.floor((now % DAY) / 60_000);

export type DirectoryRow = { ticker: string; cik: number | string; exchange: string };
const LISTED = new Set(["Nasdaq", "NYSE", "CBOE", "TXSE"]);
/** Warrants, units, rights and preferreds of a company that already has a listed common ticker. */
const securityOfOther = (ticker: string) => /-(?:P|W|U|R)/.test(ticker) || /(?:WS|WT)$/.test(ticker) || (ticker.length === 5 && /[WURZ]$/.test(ticker));

/** Every US-listed company once (the SEC lists the largest first), its other share classes, and any extra ticker (the curated list). */
export function warmUniverse(rows: DirectoryRow[], extra: string[] = []): string[] {
  const listed = rows.filter(r => LISTED.has(r.exchange) && /^[A-Z0-9.\-]{1,15}$/.test(r.ticker));
  const first = new Map<string, string>();
  for (const r of listed) if (!first.has(String(r.cik))) first.set(String(r.cik), r.ticker);
  const out: string[] = [], seen = new Set<string>();
  const add = (t: string) => { if (!seen.has(t)) { seen.add(t); out.push(t); } };
  for (const r of listed) if (first.get(String(r.cik)) === r.ticker || !securityOfOther(r.ticker)) add(r.ticker);
  for (const t of extra) if (/^[A-Z0-9.\-]{1,15}$/.test(t)) add(t);
  return out;
}

/** The companies whose turn it is in this minute: each company has one fixed minute of the day. */
export function tickersForMinute(universe: string[], now: number): { ticker: string; index: number }[] {
  const out: { ticker: string; index: number }[] = [];
  for (let i = minuteOfDay(now); i < universe.length; i += MINUTES_PER_DAY) out.push({ ticker: universe[i], index: i });
  return out;
}

/** The order in which a minute's companies may take the statements (200 credits): the minute has room for about one after its statistics
 *  and series, and its companies are the same every day, so a fixed order gave the room to the same company each day and the others were
 *  skipped for good (production log, Nov 19: skipped=LPTH:statements,CMCM:statements,...). The order turns by one company a day. */
export function statementOrder<T>(due: T[], now: number): T[] {
  if (due.length < 2) return due;
  const start = daySlot(now) % due.length;
  return [...due.slice(start), ...due.slice(0, start)];
}

/** The day of the week on which a company's need for statements is checked again (spread evenly over the week). */
export const profileDue = (index: number, now: number) => (index + daySlot(now)) % 7 === 0;

/** Room in the minute for a call. An unreadable meter means no room for the background job (it can wait for tomorrow), but a user's
 * one-credit series goes ahead (`unknownMeansRoom`). */
export function hasRoom(used: number | null, cost: number, ceiling: number, unknownMeansRoom = false): boolean {
  if (used === null || !Number.isFinite(used)) return unknownMeansRoom;
  return used + cost <= ceiling;
}

/** Credits the job's day costs for a universe, with `statementShare` of companies needing statements once a week. */
export function dailyCost(universeSize: number, statementShare: number) {
  const perMinute = Math.ceil(universeSize / MINUTES_PER_DAY);
  const regular = universeSize * (COST.statistics + COST.series);
  const statements = universeSize * statementShare * COST.statements / 7;
  return { perMinute, regularPerMinute: perMinute * (COST.statistics + COST.series), perDay: Math.round(regular + statements), averagePerMinute: Math.round((regular + statements) / MINUTES_PER_DAY) };
}
