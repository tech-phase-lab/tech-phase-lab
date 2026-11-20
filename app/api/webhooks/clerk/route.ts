import { handleClerkWebhook } from "@/lib/account/member-erasure";

// Clerk webhook (user.deleted -> member data erasure). Off unless MEMBER_ERASURE_ENABLED=true; see docs/DATA-RETENTION-2026-11-20.md.
const LIMIT = 64 * 1024;

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > LIMIT) return Response.json({ ok: false }, { status: 413 });
  const body = await request.text();
  if (new TextEncoder().encode(body).length > LIMIT) return Response.json({ ok: false }, { status: 413 });
  const result = await handleClerkWebhook({
    env: process.env, body, fetch,
    headers: { id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") },
  });
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
