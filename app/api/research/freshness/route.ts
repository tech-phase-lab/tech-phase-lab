import { assessFreshness } from "@/lib/research/freshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

// A few bytes for every page: browsers never download the monitor's full live state (owner, Oct 22).
const headers = {
  "Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
  "X-Content-Type-Options": "nosniff",
};

export async function GET() {
  try {
    const base = process.env.RESEARCH_MONITOR_URL;
    if (!base) return Response.json({ ok: true, status: "unreachable" }, { headers });
    const url = new URL(base);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local))) {
      return Response.json({ ok: true, status: "unreachable" }, { headers });
    }
    url.pathname = `${url.pathname.replace(/\/$/, "")}/live`; url.search = ""; url.hash = "";
    const token = process.env.RESEARCH_MONITOR_TOKEN;
    const response = await fetch(url, { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : undefined, signal: AbortSignal.timeout(13_000) });
    if (!response.ok) return Response.json({ ok: true, status: "unreachable" }, { headers });
    return Response.json({ ok: true, ...assessFreshness(await response.json()) }, { headers });
  } catch {
    // The monitor could not be reached: tell readers, never an error page.
    return Response.json({ ok: true, status: "unreachable" }, { headers });
  }
}
