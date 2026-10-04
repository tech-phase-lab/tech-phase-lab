import { saveMemberDisplay } from "@/lib/membership/display-server";
import { clerkClient } from "@clerk/nextjs/server";
import { getMembership } from "@/lib/membership/server";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") return Response.json({ ok: false }, { status: 404, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin ||
      !request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ ok: false }, { status: 403, headers });
  }
  try {
    const member = await getMembership();
    if (member.status !== "signed-in" || !member.isAdmin) return Response.json({ ok: false }, { status: 403, headers });
    // Only the caller's own test state is mutable. Never accept a user ID or arbitrary metadata.
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ ok: false }, { status: 400, headers });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 256) { await reader.cancel(); return Response.json({ ok: false }, { status: 413, headers }); }
      chunks.push(value);
    }
    const { mode } = JSON.parse(Buffer.concat(chunks).toString());
    if (!["free", "pro", "expiring", "restore"].includes(mode)) return Response.json({ ok: false }, { status: 400, headers });
    const now = Date.now();
    const membershipPreview = mode === "restore" ? null : {
      plan: mode === "free" ? "free" : "pro",
      proExpiresAt: new Date(now + (mode === "expiring" ? 60_000 : 3_600_000)).toISOString(),
      testUntil: new Date(now + 3_600_000).toISOString(),
    };
    await (await clerkClient()).users.updateUserMetadata(member.userId, { privateMetadata: { membershipPreview } });
    // Clear the previous presentation immediately, including when switching to FREE.
    await saveMemberDisplay();
    return Response.json({ ok: true }, { headers });
  } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
