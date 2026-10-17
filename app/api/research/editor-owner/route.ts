import { getMembership } from "@/lib/membership/server";
import { GET as readEditor, POST as writeEditor } from "../editor/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const headers = {
  "Cache-Control": "private, no-store", Vary: "Cookie",
  "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
};
const reply = (status: number, value: unknown) => Response.json(value, { status, headers });
const readKinds = new Set(["news", "signals", "official-research"]);
const writeActions = new Set(["generate", "draft", "review", "news-generate", "news-retry", "news-draft", "news-review"]);

/** Reuse the existing server-verified owner session. Do not issue another credential
 * or extend its lifetime. Annual reports and the separate post desk stay token-only. */
async function access() {
  const member = await getMembership();
  return member.status === "signed-in" && member.isAdmin === true ? member : null;
}
function credential() {
  const token = process.env.RESEARCH_EDITOR_TOKEN;
  if (!token || !/^[\x21-\x7e]{24,512}$/.test(token)) throw Error("setup-required");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
function sameOrigin(request: Request, mutation = false) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  return (!site || site === "same-origin" || site === "none")
    && (origin === new URL(request.url).origin || (!mutation && origin === null));
}
async function wrap(response: Response) {
  // Never forward upstream authentication/cookie headers to the browser.
  return reply(response.status, await response.json());
}
function unavailable(error: unknown) {
  return reply(503, { ok: false, error: error instanceof Error && error.message === "setup-required" ? "setup-required" : "editorial-service-unavailable" });
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return reply(403, { ok: false, error: "same-origin-required" });
  try {
    if (!await access()) return reply(403, { ok: false, error: "owner-required" });
    const url = new URL(request.url);
    const kinds = url.searchParams.getAll("kind");
    // Missing kind is the existing official-IR brief queue, not an open proxy.
    if (kinds.length > 1 || (kinds.length === 1 && !readKinds.has(kinds[0]))) return reply(403, { ok: false, error: "editor-scope-denied" });
    return await wrap(await readEditor(new Request(url, { headers: credential() })));
  } catch (error) { return unavailable(error); }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!sameOrigin(request, true) || contentType !== "application/json") return reply(403, { ok: false, error: "same-origin-required" });
  try {
    const member = await access();
    if (!member) return reply(403, { ok: false, error: "owner-required" });
    const reader = request.body?.getReader();
    if (!reader) return reply(400, { ok: false, error: "invalid-request-size" });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 64 * 1024) { await reader.cancel(); return reply(413, { ok: false, error: "invalid-request-size" }); }
      chunks.push(value);
    }
    let input: { action?: unknown; payload?: unknown };
    try { input = JSON.parse(Buffer.concat(chunks).toString()); }
    catch { return reply(400, { ok: false, error: "invalid-json" }); }
    if (!input || typeof input.action !== "string" || !writeActions.has(input.action)) return reply(403, { ok: false, error: "editor-scope-denied" });
    if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) return reply(400, { ok: false, error: "invalid-request" });
    // The audit identity comes from Clerk, never a browser-supplied reviewer name.
    const payload = ["review", "news-review"].includes(input.action)
      ? { ...input.payload, reviewer: member.userId } : input.payload;
    return await wrap(await writeEditor(new Request(request.url, {
      method: "POST", headers: credential(), body: JSON.stringify({ action: input.action, payload }),
    })));
  } catch (error) { return unavailable(error); }
}
