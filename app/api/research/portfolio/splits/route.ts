import { auth } from "@clerk/nextjs/server";
import { getMembership } from "@/lib/membership/server";
import { loadSplits } from "@/lib/portfolio/split-feed";
import { quotesConfigured, TICKER_PATTERN } from "@/lib/portfolio/quotes";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });

/** Splits of the held tickers in the last year, so the screen can bring shares and average cost up to date (APH, owner Nov 11). PRO only, like the quotes. */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return json({ error: "sign-in" }, 401);
  if ((await getMembership()).plan !== "pro") return json({ error: "pro-only" }, 403);
  if (!quotesConfigured()) return json({ error: "not-configured" }, 503);
  const tickers = (new URL(request.url).searchParams.get("tickers") ?? "").split(",").map(t => t.trim().toUpperCase()).filter(Boolean);
  if (!tickers.length || tickers.length > 60 || tickers.some(t => !TICKER_PATTERN.test(t))) return json({ error: "invalid-input" }, 400);
  return json({ splits: await loadSplits(tickers) });
}
