import { getMembership } from "@/lib/membership/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const reply = (status: number, data: unknown) => Response.json(data, { status, headers });

/** The key the owner's phone shortcut signs in with. Only its hash is kept; a new key replaces the old one at once and is shown once. */
function monitor(path: string) {
  const base = process.env.RESEARCH_MONITOR_URL, token = process.env.RESEARCH_EDITOR_TOKEN;
  if (!base || !token || !/^[\x21-\x7e]{24,512}$/.test(token)) throw new Error("not-configured");
  const url = new URL(base);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local))) throw new Error("invalid-monitor");
  const origin = url.origin;
  url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`; url.search = ""; url.hash = "";
  return { url, token, startUrl: `${origin}/inbox/start`, finishUrl: `${origin}/inbox/finish` };
}
async function owner() { const member = await getMembership(); return member.status === "signed-in" && member.isAdmin; }

export async function GET() {
  try {
    if (!await owner()) return reply(403, { ok: false });
    const { url, token, startUrl, finishUrl } = monitor("/admin/inbox/key");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const data = await response.json();
    if (!response.ok) return reply(503, { ok: false });
    return reply(200, { ok: true, exists: data.exists === true, createdAt: data.createdAt ?? null, startUrl, finishUrl });
  } catch { return reply(503, { ok: false }); }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply(403, { ok: false });
  try {
    if (!await owner()) return reply(403, { ok: false });
    const { url, token, startUrl, finishUrl } = monitor("/admin/inbox/key");
    const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const data = await response.json();
    if (!response.ok || typeof data.key !== "string") return reply(503, { ok: false });
    // The only place the whole key is ever sent to a screen. It is not logged and not stored here.
    return reply(200, { ok: true, key: data.key, createdAt: data.createdAt, startUrl, finishUrl });
  } catch { return reply(503, { ok: false }); }
}
