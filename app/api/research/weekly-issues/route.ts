import { getMembership } from "@/lib/membership/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const reply = (status: number, value: unknown) => Response.json(value, { status, headers });
const ACTIONS: Record<string, string> = { draft: "/admin/weekly/draft", publish: "/admin/weekly/publish", delete: "/admin/weekly/delete", settings: "/admin/weekly/settings", generate: "/admin/weekly/generate" };

/** 週刊 Tech Phase PRO. Members (PRO) read published issues; only the owner sees drafts and acts on them. Everything lives on the monitoring service. */
function monitor(path: string, tokenName: "RESEARCH_MONITOR_TOKEN" | "RESEARCH_EDITOR_TOKEN") {
  const base = process.env.RESEARCH_MONITOR_URL, token = process.env[tokenName];
  if (!base || !token || !/^[\x21-\x7e]{24,512}$/.test(token)) throw new Error("not-configured");
  const url = new URL(base);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local))) throw new Error("invalid-monitor");
  url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`; url.search = ""; url.hash = "";
  return { url, token };
}
async function call(path: string, tokenName: "RESEARCH_MONITOR_TOKEN" | "RESEARCH_EDITOR_TOKEN", init: { body?: unknown; query?: Record<string, string> } = {}) {
  const { url, token } = monitor(path, tokenName);
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, { method: init.body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) }, body: init.body === undefined ? undefined : JSON.stringify(init.body), cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  if (new TextEncoder().encode(text).length > 1_000_000) throw new Error("oversized");
  return { status: response.status, data: JSON.parse(text) };
}

export async function GET(request: Request) {
  try {
    const member = await getMembership();
    if (member.status !== "signed-in") return reply(401, { ok: false, error: "sign-in-required" });
    const params = new URL(request.url).searchParams;
    if (params.get("view") === "owner") {
      if (!member.isAdmin) return reply(403, { ok: false, error: "owner-required" });
      const result = await call("/admin/weekly", "RESEARCH_EDITOR_TOKEN");
      return reply(result.status, result.data);
    }
    // The owner can always read (to check the screen); everyone else needs PRO.
    if (member.plan !== "pro" && !member.isAdmin) return reply(403, { ok: false, error: "pro-required" });
    const query: Record<string, string> = {};
    for (const key of ["number", "before", "limit"]) {
      const value = params.get(key);
      if (value === null) continue;
      if (!/^[1-9]\d{0,5}$/.test(value)) return reply(400, { ok: false, error: "invalid-weekly-number" });
      query[key] = value;
    }
    const result = await call("/weekly/issues", "RESEARCH_MONITOR_TOKEN", { query });
    return reply(result.status, result.data);
  } catch { return reply(503, { ok: false, error: "weekly-unavailable" }); }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return reply(403, { ok: false, error: "invalid-request" });
  try {
    const member = await getMembership();
    if (member.status !== "signed-in" || !member.isAdmin) return reply(403, { ok: false, error: "owner-required" });
    const text = await request.text();
    if (!text || new TextEncoder().encode(text).length > 256_000) return reply(400, { ok: false, error: "invalid-request" });
    const input = JSON.parse(text) as { action?: unknown; payload?: unknown };
    const path = typeof input.action === "string" ? ACTIONS[input.action] : undefined;
    if (!path || !input.payload || typeof input.payload !== "object") return reply(400, { ok: false, error: "invalid-request" });
    // A person editing in the screen is not the generator: it never marks a draft as automatic.
    const payload = { ...(input.payload as Record<string, unknown>), auto: false };
    const result = await call(path, "RESEARCH_EDITOR_TOKEN", { body: payload });
    return reply(result.status, result.data);
  } catch { return reply(503, { ok: false, error: "weekly-unavailable" }); }
}
