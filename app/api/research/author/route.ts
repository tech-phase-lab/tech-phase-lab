import { getMembership } from "@/lib/membership/server";
import { GET as listPosts, POST as editPost } from "../editor/route";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (status: number, value: unknown) => Response.json(value, { status, headers });
async function access() {
  const member = await getMembership();
  if (member.status !== "signed-in" || !member.isAdmin) return null;
  return member;
}
function credential() {
  const token = process.env.RESEARCH_EDITOR_TOKEN;
  if (!token || !/^[\x21-\x7e]{24,512}$/.test(token)) throw Error("setup-required");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
export async function GET(request: Request) {
  try {
    if (!await access()) return reply(403, { ok: false, error: "owner-required" });
    const url = new URL(request.url); url.searchParams.set("kind", "posts");
    const response = await listPosts(new Request(url, { headers: credential() }));
    const data = await response.json();
    return reply(response.status, data.ok ? { ...data, items: data.items.filter((item: { kind: string }) => item.kind === "notes") } : data);
  } catch (error) { return reply(503, { ok: false, error: error instanceof Error && error.message === "setup-required" ? "setup-required" : "unavailable" }); }
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return reply(403, { ok: false });
  try {
    const member = await access();
    if (!member) return reply(403, { ok: false, error: "owner-required" });
    const auth = credential();
    const reader = request.body?.getReader(); if (!reader) return reply(400, { ok: false });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 64 * 1024) { await reader.cancel(); return reply(413, { ok: false }); } chunks.push(value); }
    const input = JSON.parse(Buffer.concat(chunks).toString());
    if (!input || !["draft", "publish", "withdraw"].includes(input.action) || typeof input.bodyJa !== "string" || input.bodyJa.length > 6000) return reply(400, { ok: false, error: "invalid-note" });
    const relay = async (action: string, payload: unknown) => {
      const response = await editPost(new Request(request.url, { method: "POST", headers: auth, body: JSON.stringify({ action, payload }) }));
      return { status: response.status, data: await response.json() };
    };
    const review = (id: string, version: number, decision: string) => relay("post-review", { id, version, kind: "notes", decision, reviewer: member.userId, reason: "Owner selected " + decision });
    if (input.action === "withdraw") { const r = await review(input.id, input.version, "withdrawn"); return reply(r.status, r.data); }
    const saved = await relay("post-draft", { id: input.id, version: input.version, kind: "notes", titleJa: "リゼルのひとりごと", bodyJa: input.bodyJa, introJa: "リゼルのひとりごと", titleEn: "", introEn: "", bodyEn: "", sourceNotes: "Owner-authored note", sources: [] });
    if (!saved.data.ok || input.action === "draft") return reply(saved.status, saved.data);
    const published = await review(saved.data.item.id, saved.data.item.version, "published");
    return reply(published.status, published.data.ok ? published.data : { ...published.data, item: saved.data.item });
  } catch (error) { return reply(503, { ok: false, error: error instanceof Error && error.message === "setup-required" ? "setup-required" : "unavailable" }); }
}
