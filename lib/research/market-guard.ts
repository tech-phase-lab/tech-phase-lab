import providers from "./providers.json" with { type: "json" };
import chainUniverse from "./chain_universe.json" with { type: "json" };
import valueCheck from "./value-check-universe.json" with { type: "json" };
import rosters from "../resolute/thermometer-rosters.json" with { type: "json" };
import { LEVERAGED_ETFS } from "./leveraged-etfs.ts";
import { providerSymbol } from "./provider-symbol.ts";
import { MAJOR_ETFS } from "./major-etfs.ts";

/** Who may make the public price APIs (/api/research/market/{quotes,facts,chart,period-bases}, /api/research/earnings-consensus) ask
 * Twelve Data, and how often (owner, Nov 26: Twelve Data use must never grow with members or visitors).
 *  - The owner's accounts: everything, always (lib/membership/entitlements.ts).
 *  - Signed-in members: any well-formed ticker for the one-credit reads (their watchlists and RESOLUTE watch items hold ETFs the SEC's
 *    company list does not name); the costly reads (a stock's facts, 70 credits for a company nobody opened; the EPS consensus, 20) only for
 *    known symbols.
 *  - Anyone else: known symbols only, and a per-address limit per server instance.
 * Known = the SEC's list of US-listed companies (the stock search's own directory, read once a day) and the site's own lists (the companies
 * it follows, the relationship-map universe, value check, the thermometer baskets, the leveraged ETFs and their stocks, widely held ETFs
 * (lib/research/major-etfs.ts), the マーケット board).
 * Pure: the server wiring (who is asking, the SEC list) is lib/research/market-access.ts. */

/** The three index pages (app/research/market/index/[id]/page.tsx). */
export const INDEX_PAGE_SYMBOLS = ["DJI", "NDX", "SPX"];
const lists: string[][] = [
  (providers as { ticker: string }[]).map(p => p.ticker),
  ((chainUniverse as { companies: { id: string }[] }).companies ?? []).map(c => c.id),
  Object.keys((valueCheck as { companies: Record<string, unknown> }).companies ?? {}),
  (rosters as { nasdaq100: { tickers: string[] }; semiconductors: { tickers: string[] } }).nasdaq100.tickers,
  (rosters as { semiconductors: { tickers: string[] } }).semiconductors.tickers,
  LEVERAGED_ETFS.flatMap(item => [item.etf, item.underlying]),
  INDEX_PAGE_SYMBOLS,
  [...MAJOR_ETFS],
];
/** The site's own symbols (no network needed). */
export const SITE_TICKERS: ReadonlySet<string> = new Set(lists.flat().filter(t => typeof t === "string").map(t => t.toUpperCase()));

export type Caller = "owner" | "member" | "anonymous";
export type Cost = "light" | "heavy";

/** True when `ticker` may be read for this caller. `directory` is the SEC list (null when it could not be read: the site's lists only). */
export function tickerAllowed(ticker: string, caller: Caller, cost: Cost, directory: ReadonlySet<string> | null, extra: (t: string) => boolean = () => false): boolean {
  if (caller === "owner") return true;
  if (caller === "member" && cost === "light") return true;
  const t = ticker.toUpperCase();
  if (SITE_TICKERS.has(t) || extra(t)) return true;
  if (!directory) return false;
  // The SEC writes a share class with a dash (BRK-B), the provider and our pages with a dot (BRK.B).
  return directory.has(t) || directory.has(t.replace(".", "-")) || directory.has(providerSymbol(t));
}

/** The caller's address as the hosting platform reports it (the first hop of x-forwarded-for), never stored or logged. */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for") ?? headers.get("x-real-ip") ?? "";
  const first = forwarded.split(",")[0]?.trim() ?? "";
  return /^[0-9a-fA-F:.]{2,45}$/.test(first) ? first : "unknown";
}

/** Requests a minute one address may make, per server instance, for visitors who are not signed in. A watchlist polled every 15 seconds
 * with a stock page open stays far below them; the one-credit reads allow many people behind one address (Japanese mobile carriers share
 * addresses), and most of those reads are answered from the shared copies without asking the provider. */
export const ANONYMOUS_PER_MINUTE: Record<Cost, number> = { light: 300, heavy: 20 };
const ADDRESSES_KEPT = 20_000;

/** A sliding one-minute window per address and cost class. */
export function createAddressLimiter(limits: Record<Cost, number> = ANONYMOUS_PER_MINUTE, now: () => number = Date.now) {
  const seen = new Map<string, number[]>();
  return function allow(address: string, cost: Cost): boolean {
    const key = `${cost}|${address}`, t = now();
    const recent = (seen.get(key) ?? []).filter(at => at > t - 60_000);
    if (recent.length >= limits[cost]) { seen.set(key, recent); return false; }
    recent.push(t);
    seen.delete(key); seen.set(key, recent);
    if (seen.size > ADDRESSES_KEPT) seen.delete(seen.keys().next().value!);
    return true;
  };
}
