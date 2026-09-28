import { createHmac } from "node:crypto";
import { getMembership } from "@/lib/membership/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const reply = (status: number, value: unknown) => Response.json(value, { status, headers });

function configuration() {
  const base = process.env.RESEARCH_MONITOR_URL;
  const token = process.env.RESEARCH_MONITOR_TOKEN;
  if (!base || !token || !/^[\x21-\x7e]{24,512}$/.test(token)) throw new Error("not-configured");
  const url = new URL(base);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local))) throw new Error("invalid-monitor");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/questions`; url.search = ""; url.hash = "";
  return { url, token };
}

async function identity() {
  const member = await getMembership();
  if (member.status !== "signed-in") return null;
  const { url, token } = configuration();
  const ownerKey = createHmac("sha256", token).update(`question:${member.userId}`).digest("hex");
  return { url, token, ownerKey };
}

async function parse(response: Response) {
  const text = await response.text();
  if (new TextEncoder().encode(text).length > 256_000) throw new Error("oversized");
  try { return JSON.parse(text); } catch { throw new Error("invalid-response"); }
}

export async function GET() {
  try {
    const account = await identity();
    if (!account) return reply(401, { ok: false, error: "sign-in-required" });
    const response = await fetch(account.url, { headers: { Authorization: `Bearer ${account.token}`, "X-Question-Owner": account.ownerKey }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    return reply(response.status, await parse(response));
  } catch { return reply(503, { ok: false, error: "questions-unavailable" }); }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return reply(403, { ok: false, error: "invalid-request" });
  try {
    const account = await identity();
    if (!account) return reply(401, { ok: false, error: "sign-in-required" });
    const text = await request.text();
    if (!text || new TextEncoder().encode(text).length > 8_000) return reply(400, { ok: false, error: "invalid-request" });
    const input = JSON.parse(text) as { requestId?: unknown; body?: unknown };
    if (typeof input.requestId !== "string" || !/^q-[a-f0-9]{32}$/.test(input.requestId) || typeof input.body !== "string" || input.body.trim().length < 10 || input.body.length > 1200 || input.body.includes("\0")) return reply(400, { ok: false, error: "invalid-question" });
    const response = await fetch(account.url, { method: "POST", headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ownerKey: account.ownerKey, requestId: input.requestId, body: input.body }), cache: "no-store", signal: AbortSignal.timeout(10_000) });
    return reply(response.status, await parse(response));
  } catch { return reply(503, { ok: false, error: "questions-unavailable" }); }
}
