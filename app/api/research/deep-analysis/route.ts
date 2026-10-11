import { getMembership } from "@/lib/membership/server";
import { parseDeepAnalyses } from "@/lib/research/deep-analysis";

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
    return Response.json({ items: parseDeepAnalyses(JSON.parse(text)) }, { headers });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
