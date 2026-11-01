import { auth } from "@clerk/nextjs/server";
import { getMembership } from "@/lib/membership/server";
import { loadQuotes, quotesConfigured, TICKER_PATTERN } from "@/lib/portfolio/quotes";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });

/** Latest closes for the tickers the reader holds, plus USD/JPY. Signed-in only (the data costs credits). */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return json({ error: "sign-in" }, 401);
  // PRO members only (the owner counts as PRO): the reading costs money and the feature is part of PRO.
  if ((await getMembership()).plan !== "pro") return json({ error: "pro-only" }, 403);
  if (!quotesConfigured()) return json({ error: "not-configured" }, 503);
  const tickers = (new URL(request.url).searchParams.get("tickers") ?? "").split(",").map(t => t.trim().toUpperCase()).filter(Boolean);
  if (!tickers.length || tickers.length > 60 || tickers.some(t => !TICKER_PATTERN.test(t))) return json({ error: "invalid-input" }, 400);
  try { return json(await loadQuotes(tickers)); } catch { return json({ error: "unavailable" }, 503); }
}
