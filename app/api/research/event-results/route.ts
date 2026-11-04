import { getMembership } from "@/lib/membership/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const reply = (status: number, value: unknown) => Response.json(value, { status, headers });

/** The owner takes down a result that was published automatically from the outlets' headlines. A withdrawn result is never published again. */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return reply(403, { ok: false, error: "invalid-request" });
  try {
    const member = await getMembership();
    if (member.status !== "signed-in" || !member.isAdmin) return reply(403, { ok: false, error: "owner-required" });
    const text = await request.text();
    const input = text && text.length < 2000 ? JSON.parse(text) as { id?: unknown } : {};
    if (typeof input.id !== "string" || !/^[a-z0-9-]{3,80}$/.test(input.id)) return reply(400, { ok: false, error: "invalid-request" });
    const base = process.env.RESEARCH_MONITOR_URL, token = process.env.RESEARCH_EDITOR_TOKEN;
    if (!base || !token || !/^[\x21-\x7e]{24,512}$/.test(token)) return reply(503, { ok: false, error: "not-configured" });
    const url = new URL(base);
    if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)))) return reply(503, { ok: false, error: "invalid-monitor" });
    url.pathname = `${url.pathname.replace(/\/$/, "")}/admin/event-results/withdraw`; url.search = ""; url.hash = "";
    const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: input.id }), cache: "no-store", signal: AbortSignal.timeout(10_000) });
    return reply(response.status, await response.json());
  } catch { return reply(503, { ok: false, error: "event-results-unavailable" }); }
}
