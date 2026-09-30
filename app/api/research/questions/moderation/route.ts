import { getMembership } from "@/lib/membership/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const reply = (status: number, value: unknown) => Response.json(value, { status, headers });

function configuration(path: string) {
  const base = process.env.RESEARCH_MONITOR_URL;
  const token = process.env.RESEARCH_EDITOR_TOKEN;
  if (!base || !token || !/^[\x21-\x7e]{24,512}$/.test(token)) throw new Error("not-configured");
  const url = new URL(base);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local))) throw new Error("invalid-monitor");
  url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`; url.search = ""; url.hash = "";
  return { url, token };
}

async function owner() {
  const member = await getMembership();
  return member.status === "signed-in" && member.isAdmin;
}

async function relay(url: URL, token: string, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  if (new TextEncoder().encode(text).length > 512_000) return reply(502, { ok: false, error: "oversized-response" });
  try { return reply(response.status, JSON.parse(text)); } catch { return reply(502, { ok: false, error: "invalid-response" }); }
}

export async function GET(request: Request) {
  try {
    if (!await owner()) return reply(403, { ok: false, error: "owner-required" });
    const view = new URL(request.url).searchParams.get("view") ?? "pending";
    if (!new Set(["pending", "answered", "closed", "all"]).has(view)) return reply(400, { ok: false, error: "invalid-view" });
    const { url, token } = configuration("/admin/questions"); url.searchParams.set("view", view);
    return relay(url, token, {});
  } catch { return reply(503, { ok: false, error: "questions-unavailable" }); }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return reply(403, { ok: false, error: "invalid-request" });
  try {
    if (!await owner()) return reply(403, { ok: false, error: "owner-required" });
    const text = await request.text();
    if (!text || new TextEncoder().encode(text).length > 32_000) return reply(400, { ok: false, error: "invalid-request" });
    const input = JSON.parse(text) as { id?: unknown; decision?: unknown; answerPostId?: unknown; body?: unknown };
    if (input.decision === "reply") {
      if (typeof input.id !== "string" || !/^q-[a-f0-9]{32}$/.test(input.id) || typeof input.body !== "string" || !input.body.trim() || input.body.length > 6000 || input.body.includes("\0")) return reply(400, { ok: false, error: "invalid-answer" });
      const { url, token } = configuration("/admin/questions/answer");
      return relay(url, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: input.id, body: input.body }) });
    }
    if (typeof input.id !== "string" || !/^q-[a-f0-9]{32}$/.test(input.id) || !["pending", "answered", "closed"].includes(String(input.decision)) || (input.answerPostId != null && (typeof input.answerPostId !== "string" || input.answerPostId.length > 64))) return reply(400, { ok: false, error: "invalid-request" });
    const { url, token } = configuration("/admin/questions/review");
    return relay(url, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  } catch { return reply(503, { ok: false, error: "questions-unavailable" }); }
}
