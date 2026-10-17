import { getMembershipForUser } from "@/lib/membership/server";
import { validSyncToken } from "@/lib/membership/sync-auth";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
// The monitor rechecks entitlement before delivery, including when the browser is closed.
export async function GET(request: Request) {
  if (!validSyncToken(request.headers.get("authorization"), process.env.RESEARCH_MONITOR_TOKEN)) {
    return Response.json({ ok: false }, { status: 401, headers });
  }
  const id = new URL(request.url).searchParams.get("memberId") ?? "";
  if (!/^user_[A-Za-z0-9]{1,128}$/.test(id)) return Response.json({ ok: false }, { status: 400, headers });
  try {
    const member = await getMembershipForUser(id);
    return Response.json({ ok: true, pro: member.plan === "pro", accessExpiresAt: member.accessExpiresAt / 1000 }, { headers });
  } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
