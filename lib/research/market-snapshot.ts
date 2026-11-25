/** マーケット: every tab's cards and each tab's first chart from ONE shared snapshot (owner, Nov 25: a tab not opened yet — 暗号資産, 金属 … —
 * took seconds before anything showed; it must show at once, like レバETF). The site's minute job (app/api/research/compare/warm, run every
 * minute by the Railway monitor) refreshes it through the allocator's lease on the "warm" tier, which yields to the member reserve; a member's
 * request only reads it. The page still asks for fresher copies afterwards exactly as before; the snapshot only makes the first paint instant.
 * The refreshed quotes and bars are also stored in the same shared copies members' reads use, so those reads find them instead of the provider. */
export const BOARD_SNAPSHOT_QUOTES: readonly string[] = [
  "SPY", "QQQ", "DIA",
  "USD/JPY", "EUR/JPY", "EUR/USD", "GBP/USD",
  "BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD",
  "XAU/USD", "XAG/USD", "XCU/USD", "XPT/USD",
  "SHY", "IEF", "TLT",
  "SMH", "SOXX",
];
/** The chart each tab opens on (its first card) at the board's first period (15 minutes). */
export const BOARD_SNAPSHOT_CHARTS: readonly string[] = ["USD/JPY", "BTC/USD", "XAU/USD", "SHY", "SMH"];
export const BOARD_SNAPSHOT_PERIOD = "15m";

/** A symbol is read again once this old: every ~2 minutes while its market trades (currency pairs, crypto and metals around the clock; U.S.
 * ETFs 04:00–20:00 New York), every 15 minutes otherwise. Never-read symbols first, then the oldest; at most BOARD_PER_RUN reads a minute. */
export const BOARD_TRADING_AGE_MS = 90_000, BOARD_CLOSED_AGE_MS = 15 * 60_000, BOARD_PER_RUN = 25;
export type BoardJob = { kind: "quote" | "chart"; id: string };
export const boardJobKey = (job: BoardJob) => `${job.kind}:${job.id}`;
export const aroundTheClock = (id: string) => id.includes("/");
export function boardDue(ages: Record<string, number | undefined>, stocksOpen: boolean): BoardJob[] {
  const jobs: BoardJob[] = [...BOARD_SNAPSHOT_QUOTES.map(id => ({ kind: "quote" as const, id })), ...BOARD_SNAPSHOT_CHARTS.map(id => ({ kind: "chart" as const, id }))];
  const age = (job: BoardJob) => ages[boardJobKey(job)];
  const never = jobs.filter(job => age(job) === undefined);
  const old = jobs.filter(job => age(job) !== undefined && age(job)! >= (aroundTheClock(job.id) || stocksOpen ? BOARD_TRADING_AGE_MS : BOARD_CLOSED_AGE_MS))
    .sort((a, b) => age(b)! - age(a)!);
  return [...never, ...old].slice(0, BOARD_PER_RUN);
}
/** Credits (one a quote, one a 15-minute series): reads per minute on average while U.S. stocks trade and while they do not. */
export function boardCreditsPerMinute() {
  const all = BOARD_SNAPSHOT_QUOTES.length + BOARD_SNAPSHOT_CHARTS.length;
  const clock = BOARD_SNAPSHOT_QUOTES.filter(aroundTheClock).length + BOARD_SNAPSHOT_CHARTS.filter(aroundTheClock).length;
  return { trading: all / 2, closed: clock / 2 + (all - clock) / 15, peak: BOARD_PER_RUN };
}
