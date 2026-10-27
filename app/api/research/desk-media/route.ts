import { getMembership } from "@/lib/membership/server";
import { audioStorage, beginAudioUpload, finishAudioUpload } from "@/lib/research/desk-audio-storage";
import { deskAudioFile, validAudioUpload, maxDeskAudioBytes } from "@/lib/research/desk-audio";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const reply = (status: number, data: unknown) => Response.json(data, { status, headers });
export async function GET() {
  try {
    const member = await getMembership();
    if (member.status !== "signed-in" || !member.isAdmin) return reply(403, { ok: false });
    try { const { client } = audioStorage(); client.destroy(); return reply(200, { ok: true, enabled: true, maxBytes: maxDeskAudioBytes, draftOwner: member.userId }); }
    catch { return reply(200, { ok: true, enabled: false, maxBytes: maxDeskAudioBytes, draftOwner: member.userId }); }
  } catch { return reply(503, { ok: false }); }
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply(403, { ok: false });
  try {
    const member = await getMembership();
    if (member.status !== "signed-in" || !member.isAdmin) return reply(403, { ok: false, error: "owner-required" });
    const reader = request.body?.getReader(); if (!reader) return reply(400, { ok: false });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4096) { await reader.cancel(); return reply(413, { ok: false }); } chunks.push(value); }
    let input; try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { return reply(400, { ok: false }); }
    if (input?.action === "start" && validAudioUpload(input.name, input.size)) return reply(200, { ok: true, ...await beginAudioUpload(input.size, input.name) });
    if (input?.action === "finish" && typeof input.file === "string" && deskAudioFile.test(input.file)) return reply(200, { ok: true, url: await finishAudioUpload(input.file) });
    return reply(400, { ok: false, error: "audio-only" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return reply(["invalid-mp3", "invalid-audio"].includes(message) ? 400 : 503, { ok: false, error: message === "storage-not-configured" ? "setup-required" : ["invalid-mp3", "invalid-audio"].includes(message) ? "audio-only" : "upload-unavailable" });
  }
}
