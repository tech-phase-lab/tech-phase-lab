import { getMembership } from "@/lib/membership/server";
import { publishedPosts } from "@/lib/research/editorial-posts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
export async function GET() {
  try {
    const member = await getMembership();
    if (member.status === "unavailable") throw new Error("membership-unavailable");
    const pro = member.status === "signed-in" && member.plan === "pro" && Number.isFinite(member.accessExpiresAt) && member.accessExpiresAt > Date.now();
    const base = process.env.RESEARCH_MONITOR_URL;
    const token = process.env.RESEARCH_MONITOR_TOKEN;
    if (!base || !token) throw new Error("not-configured");
    const url = new URL(base);
    if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("invalid-monitor");
    url.pathname = `${url.pathname.replace(/\/$/, "")}/posts`; url.search = ""; url.hash = "";
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("unavailable");
    const text = await response.text();
    if (new TextEncoder().encode(text).length > 2_000_000) throw new Error("oversized");
    // Recheck the clock after upstream I/O; membership may expire while fetching.
    const allowed = pro && member.accessExpiresAt! > Date.now();
    return Response.json({ ok: true, items: publishedPosts(JSON.parse(text), allowed),
      access: allowed ? "pro" : member.status === "signed-in" ? "pro-required" : "sign-in",
      validUntil: allowed ? Math.min(member.accessExpiresAt!, Date.now() + 60_000) : Date.now() + 60_000 }, { headers });
  } catch { return Response.json({ ok: false, items: [] }, { status: 503, headers }); }
}
