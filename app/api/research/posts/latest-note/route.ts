import { publishedPosts } from "@/lib/research/editorial-posts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET() {
  try {
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
    const note = publishedPosts(JSON.parse(text), false).find(item => item.kind === "notes");
    // This endpoint is intentionally incapable of returning a PRO body or a
    // legacy note headline. The home page needs only safe discovery metadata.
    return Response.json({ ok: true, item: note ? { id: note.id, publishedAt: note.publishedAt, translationStatus: note.translationStatus } : null }, { headers });
  } catch { return Response.json({ ok: false, item: null }, { status: 503, headers }); }
}
