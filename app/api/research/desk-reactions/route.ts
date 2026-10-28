import { createHmac } from "node:crypto";
import { getMembership } from "@/lib/membership/server";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const reply = (status: number, value: unknown) => Response.json(value, { status, headers });
async function relay(request: Request, write = false) {
  try {
    const member = await getMembership();
    if (member.status !== "signed-in") return reply(401, { ok: false });
    if (member.plan !== "pro") return reply(403, { ok: false });
    const token = process.env.RESEARCH_MONITOR_TOKEN, base = process.env.RESEARCH_MONITOR_URL;
    if (!token || !base) return reply(503, { ok: false });
    const url = new URL(base);
    if (url.protocol !== "https:" || url.username || url.password) return reply(503, { ok: false });
    url.pathname = `${url.pathname.replace(/\/$/, "")}/desk-reactions`; url.search = ""; url.hash = "";
    let body: string | undefined;
    let postId = new URL(request.url).searchParams.get("postId");
    if (write) {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > 2000) return reply(400, { ok: false });
      const input = JSON.parse(text);
      postId = input.postId;
      if (!["like", "smile", "sad", "angry", "fire"].includes(input.emoji) || typeof input.selected !== "boolean") return reply(400, { ok: false });
      body = JSON.stringify({ postId, emoji: input.emoji, selected: input.selected });
    }
    if (typeof postId !== "string" || !/^[a-z0-9-]{16,64}$/.test(postId)) return reply(400, { ok: false });
    if (!write) url.searchParams.set("postId", postId);
    const owner = createHmac("sha256", token).update(`desk-reaction:${member.userId}`).digest("hex");
    const response = await fetch(url, { method: write ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "X-Reaction-Owner": owner, "Content-Type": "application/json" }, body, cache: "no-store", signal: AbortSignal.timeout(10000) });
    const text = await response.text();
    if (text.length > 4000) throw Error();
    return reply(response.status, JSON.parse(text));
  } catch { return reply(503, { ok: false }); }
}
export async function GET(request: Request) { return relay(request); }
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return reply(403, { ok: false });
  return relay(request, true);
}
