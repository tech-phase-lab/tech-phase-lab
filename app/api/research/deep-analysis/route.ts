import { getMembership } from "@/lib/membership/server";
import { parseDeepAnalyses, type DeepAnalysis } from "@/lib/research/deep-analysis";
import { loadMarketReaction } from "@/lib/research/market-reaction-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** PRO only: the monitor serves analyses to this server, never to browsers. */
export async function GET() {
  try {
    const member = await getMembership();
    if (member.status === "unavailable") return Response.json({ error: "unavailable" }, { status: 503, headers });
    if (member.status !== "signed-in") return Response.json({ error: "sign-in" }, { status: 401, headers });
    if (member.plan !== "pro" || !Number.isFinite(member.accessExpiresAt) || member.accessExpiresAt <= Date.now()) {
      return Response.json({ error: "pro-required" }, { status: 403, headers });
    }
    const base = process.env.RESEARCH_MONITOR_URL, token = process.env.RESEARCH_MONITOR_TOKEN;
    if (!base || !token) throw Error("Not configured");
    const url = new URL(base);
    if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw Error("Invalid monitor");
    url.pathname = `${url.pathname.replace(/\/$/, "")}/deep-analyses`; url.search = ""; url.hash = "";
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw Error("Unavailable");
    const text = await response.text();
    if (new TextEncoder().encode(text).length > 400_000) throw Error("Oversized response");
    return Response.json({ items: await withReactions(parseDeepAnalyses(JSON.parse(text))) }, { headers });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}

/** 「翌日の市場の反応」 (owner, Nov 18): each company's newest earnings analysis gets the next-day reaction computed from daily prices, once that
 * session has closed. Prices only, no model; a reaction that cannot be computed yet is simply absent. */
async function withReactions(items: DeepAnalysis[]): Promise<DeepAnalysis[]> {
  const newest = new Map<string, DeepAnalysis>();
  for (const item of items) if (item.kind === "earnings" && !newest.has(item.subject)) newest.set(item.subject, item);
  const reactions = new Map(await Promise.all([...newest.values()].map(async item =>
    [item.id, await loadMarketReaction(item.subject, item.releasedAt ?? item.publishedAt)] as const)));
  return items.map(item => reactions.get(item.id) ? { ...item, reaction: reactions.get(item.id) } : item);
}
