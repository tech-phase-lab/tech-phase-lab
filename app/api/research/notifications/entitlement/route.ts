import { getMembershipForUser } from "@/lib/membership/server";
import { isOwnerAccount } from "@/lib/membership/entitlements";
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
  // The operator (owner) account may use every feature, PRO or not, in every environment (owner, Nov 13): operational access, not a
  // subscription. Answered here, before any Clerk lookup, so a preview deployment, a missing flag or a metadata change cannot turn it off.
  if (isOwnerAccount(id)) return Response.json({ ok: true, pro: true, accessExpiresAt: (Date.now() + 3_600_000) / 1000, owner: true, environment: process.env.VERCEL_ENV ?? "unknown" }, { headers });
  try {
    const member = await getMembershipForUser(id, undefined, { monitorCheck: true });
    // `environment` says which deployment answered (production or preview): the owner's one-hour access exists only in production.
    return Response.json({ ok: true, pro: member.plan === "pro", accessExpiresAt: member.accessExpiresAt / 1000, environment: process.env.VERCEL_ENV ?? "unknown" }, { headers });
  } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
