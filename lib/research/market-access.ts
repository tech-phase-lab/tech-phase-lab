import "server-only";
import { auth } from "@clerk/nextjs/server";
import { isOwnerAccount } from "@/lib/membership/entitlements";
import { parseSecDirectory } from "./stock-directory";
import { clientAddress, createAddressLimiter, tickerAllowed, type Caller, type Cost } from "./market-guard";

/** The server side of lib/research/market-guard.ts: who is asking (Clerk, through proxy.ts), the SEC's company list, and the per-address
 * limit for visitors who are not signed in. */

const DIRECTORY_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
const DIRECTORY_MAX_BYTES = 2_000_000;
const DIRECTORY_KEEP_MS = 6 * 3600_000, DIRECTORY_RETRY_MS = 5 * 60_000;
let directory: { tickers: ReadonlySet<string> | null; at: number } | null = null;
let reading: Promise<void> | null = null;

/** The SEC's list of listed companies (the stock search reads the same file with the same request, so the data cache holds one copy a day).
 * null when it cannot be read: visitors then get the site's own lists only. */
export async function directoryTickers(): Promise<ReadonlySet<string> | null> {
  const t = Date.now();
  if (directory && t - directory.at < (directory.tickers ? DIRECTORY_KEEP_MS : DIRECTORY_RETRY_MS)) return directory.tickers;
  reading ??= (async () => {
    try {
      const response = await fetch(DIRECTORY_URL, {
        headers: { Accept: "application/json", "User-Agent": process.env.RESEARCH_USER_AGENT || "TechPhaseResearch/1.0 research-preview" },
        next: { revalidate: 86_400, tags: ["sec-stock-directory"] }, signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error("sec-directory");
      const text = await response.text();
      if (text.length > DIRECTORY_MAX_BYTES) throw new Error("sec-directory-size");
      directory = { tickers: new Set(parseSecDirectory(JSON.parse(text)).map(entry => entry.ticker)), at: Date.now() };
    } catch { directory = { tickers: directory?.tickers ?? null, at: Date.now() }; }
  })().finally(() => { reading = null; });
  await reading;
  return directory?.tickers ?? null;
}

/** The owner's accounts, a signed-in member, or a visitor. Clerk unavailable or not configured: a visitor. */
export async function marketCaller(): Promise<Caller> {
  try {
    if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return "anonymous";
    const { userId } = await auth();
    return isOwnerAccount(userId) ? "owner" : userId ? "member" : "anonymous";
  } catch { return "anonymous"; }
}

const allowAddress = createAddressLimiter();
const noStore = { "Cache-Control": "no-store" };
export type MarketAccess = { caller: Caller; allowed: (ticker: string) => boolean };

/** Before a public price route reads anything: a visitor over the per-address limit gets 429 (and nothing is read); otherwise the rule
 * for which tickers this caller may have read. `extra`: symbols the route itself serves (the マーケット board's ids). */
export async function marketAccess(request: Request, cost: Cost, extra?: (ticker: string) => boolean): Promise<MarketAccess | Response> {
  const caller = await marketCaller();
  if (caller === "anonymous" && !allowAddress(clientAddress(request.headers), cost)) {
    return Response.json({ ok: false, error: "rate-limited" }, { status: 429, headers: { ...noStore, "Retry-After": "60" } });
  }
  const needsDirectory = caller === "anonymous" || (caller === "member" && cost === "heavy");
  const list = needsDirectory ? await directoryTickers() : null;
  return { caller, allowed: ticker => tickerAllowed(ticker, caller, cost, list, extra) };
}
