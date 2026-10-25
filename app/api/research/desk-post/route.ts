import { getMembership } from "@/lib/membership/server";
import { POST as editPost } from "../editor/route";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (status: number, value: unknown) => Response.json(value, { status, headers });
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply(403, { ok: false });
  try {
    const member = await getMembership();
    if (member.status !== "signed-in" || !member.isAdmin) return reply(403, { ok: false, error: "owner-required" });
    const token = process.env.RESEARCH_EDITOR_TOKEN;
    if (!token || !/^[\x21-\x7e]{24,512}$/.test(token)) return reply(503, { ok: false, error: "setup-required" });
    const reader = request.body?.getReader(); if (!reader) return reply(400, { ok: false });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 32000) { await reader.cancel(); return reply(413, { ok: false }); } chunks.push(value); }
    const input = JSON.parse(Buffer.concat(chunks).toString());
    if (!input || !["notes", "qa"].includes(input.kind) || !["edit", "delete"].includes(input.action) || typeof input.id !== "string" || !/^[a-z0-9-]{16,64}$/.test(input.id) || !Number.isSafeInteger(input.version) || input.version < 1 || (input.action === "edit" && (typeof input.bodyJa !== "string" || !input.bodyJa.trim() || input.bodyJa.length > 6000 || input.bodyJa.includes("\0")))) return reply(400, { ok: false, error: "invalid-post" });
    const payload = { id: input.id, version: input.version, kind: input.kind, decision: input.action === "edit" ? "corrected" : "withdrawn", ...(input.action === "edit" ? { bodyJa: input.bodyJa } : {}), reviewer: member.userId, reason: input.action === "edit" ? "Owner corrected published post" : "Owner deleted published post" };
    const response = await editPost(new Request(request.url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "post-review", payload }) }));
    return reply(response.status, await response.json());
  } catch { return reply(503, { ok: false, error: "post-unavailable" }); }
}
