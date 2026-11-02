import { getMembership } from "@/lib/membership/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const reply = (status: number, data: unknown) => Response.json(data, { status, headers });
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** The owner's inbox of voice memos sent from the phone. The memos live on the monitoring service (it takes the upload, which is
 * too big for this site) and in the private bucket; this route only lets the signed-in owner list, play, rename and mark them. */
function monitor(path: string, query?: Record<string, string>) {
  const base = process.env.RESEARCH_MONITOR_URL, token = process.env.RESEARCH_EDITOR_TOKEN;
  if (!base || !token || !/^[\x21-\x7e]{24,512}$/.test(token)) throw new Error("not-configured");
  const url = new URL(base);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local))) throw new Error("invalid-monitor");
  url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`; url.search = ""; url.hash = "";
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  return { url, token, origin: url.origin };
}
async function owner() { const member = await getMembership(); return member.status === "signed-in" && member.isAdmin; }
async function call(path: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}) {
  const { url, token } = monitor(path, init.query);
  const response = await fetch(url, { method: init.method ?? "GET", headers: { Authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) }, body: init.body === undefined ? undefined : JSON.stringify(init.body), cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  if (new TextEncoder().encode(text).length > 256_000) throw new Error("oversized");
  return { status: response.status, data: JSON.parse(text) };
}

export async function GET(request: Request) {
  try {
    if (!await owner()) return reply(403, { ok: false });
    const id = new URL(request.url).searchParams.get("id");
    if (id !== null) {
      if (!ID.test(id)) return reply(400, { ok: false });
      const link = await call("/admin/inbox/file", { query: { id } });
      const target = typeof link.data?.url === "string" ? link.data.url : "";
      // Only a signed address in the private bucket is ever followed.
      if (link.status !== 200 || !/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com\//.test(target)) return reply(link.status === 404 ? 404 : 503, { ok: false });
      return new Response(null, { status: 307, headers: { ...headers, Location: target } });
    }
    const [list, key] = await Promise.all([call("/admin/inbox/items"), call("/admin/inbox/key")]);
    if (list.status !== 200 || !Array.isArray(list.data?.items)) return reply(503, { ok: false });
    return reply(200, { ok: true, enabled: key.data?.exists === true, items: list.data.items });
  } catch { return reply(503, { ok: false }); }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return reply(403, { ok: false });
  try {
    if (!await owner()) return reply(403, { ok: false });
    const text = await request.text();
    if (!text || new TextEncoder().encode(text).length > 4096) return reply(400, { ok: false });
    const input = JSON.parse(text) as { action?: unknown; id?: unknown; title?: unknown };
    if (typeof input.id !== "string" || !ID.test(input.id)) return reply(400, { ok: false });
    if (input.action === "rename") {
      if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 80 || input.title.includes("\0")) return reply(400, { ok: false, error: "invalid-title" });
      const result = await call("/admin/inbox/rename", { method: "POST", body: { id: input.id, title: input.title } });
      return reply(result.status, result.data);
    }
    if (input.action === "read") {
      const result = await call("/admin/inbox/read", { method: "POST", body: { id: input.id } });
      return reply(result.status, result.data);
    }
    return reply(400, { ok: false });
  } catch { return reply(503, { ok: false }); }
}
