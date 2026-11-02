import { getMembership } from "@/lib/membership/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const reply = (status: number, data: unknown) => Response.json(data, { status, headers });

/** The owner's inbox of voice memos sent from the phone. The screen is built first: the receiving side (the endpoint the iPhone shortcut
 * posts to, and its key) is still being decided, so nothing is received yet and the list is empty. */
export async function GET(request: Request) {
  try {
    const member = await getMembership();
    if (member.status !== "signed-in" || !member.isAdmin) return reply(403, { ok: false });
    // One file is not served yet: there is nothing in the inbox to serve.
    if (new URL(request.url).searchParams.has("id")) return reply(404, { ok: false });
    return reply(200, { ok: true, enabled: false, items: [] });
  } catch { return reply(503, { ok: false }); }
}
