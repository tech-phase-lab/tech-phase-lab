import { getMembership } from "@/lib/membership/server";
import { parseWhaleSnapshot, whaleMovesAccess, whaleMovesEnabled } from "@/lib/research/whale-moves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status, headers });

/** クジラの足あと (PRO; the owner's accounts always). Per-ticker totals from the research monitor (13F, FINRA, Form 4, buybacks). */
export async function GET() {
  try {
    const member = await getMembership().catch(() => ({ status: "unavailable", plan: "free" }));
    const access = whaleMovesAccess(member, whaleMovesEnabled());
    if (access !== 200) return fail(access, access === 401 ? "sign-in" : access === 403 ? "pro-required" : access === 404 ? "not-found" : "unavailable");
    const base = process.env.RESEARCH_MONITOR_URL, token = process.env.RESEARCH_MONITOR_TOKEN;
    if (!base || !token) return fail(503, "not-connected");
    const url = new URL(base);
    if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)))) return fail(503, "not-connected");
    url.pathname = `${url.pathname.replace(/\/$/, "")}/ownership`; url.search = ""; url.hash = "";
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (response.status === 503) return fail(503, "not-ready");
    if (!response.ok) return fail(503, "unavailable");
    const body = await response.text();
    if (new TextEncoder().encode(body).length > 1_500_000) return fail(503, "unavailable");
    return Response.json(parseWhaleSnapshot(JSON.parse(body)), { headers });
  } catch { return fail(503, "unavailable"); }
}
