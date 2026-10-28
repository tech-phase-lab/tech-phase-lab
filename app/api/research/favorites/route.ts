import { createHmac } from "node:crypto";
import { getMembership } from "@/lib/membership/server";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const reply = (status: number, data: unknown) => Response.json(data, { status, headers });
async function proxy(request?: Request) {
  try {
    const member = await getMembership();
    if (member.status !== "signed-in") return reply(member.status === "signed-out" ? 401 : 503, { ok: false });
    const token = process.env.RESEARCH_MONITOR_TOKEN, base = process.env.RESEARCH_MONITOR_URL;
    if (!token || !base) return reply(503, { ok: false });
    const url = new URL(base);
    if (url.protocol !== "https:" || url.username || url.password) return reply(503, { ok: false });
    url.pathname = `${url.pathname.replace(/\/$/, "")}/favorite-lists`; url.search = ""; url.hash = "";
    const owner = createHmac("sha256", token).update(`favorites:${member.userId}`).digest("hex");
    const body = request ? await request.text() : undefined;
    if (body && JSON.parse(body).account !== owner) return reply(409, { ok: false, error: "account-changed" });
    if (body && new TextEncoder().encode(body).length > 60000) return reply(413, { ok: false });
    const result = await fetch(url, { method: request ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "X-Favorites-Owner": owner, "Content-Type": "application/json" }, body, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (![200, 400, 409].includes(result.status)) return reply(503, { ok: false });
    const text = await result.text();
    if (text.length > 200000) return reply(503, { ok: false });
    const value = JSON.parse(text);
    return reply(result.status, { ...value, account: owner });
  } catch { return reply(503, { ok: false }); }
}
export async function GET() { return proxy(); }
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return reply(403, { ok: false });
  return proxy(request);
}
