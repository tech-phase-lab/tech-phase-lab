import { saveMemberDisplay } from "@/lib/membership/display-server";
import { getMembership } from "@/lib/membership/server";
import { sessionDiagnostic } from "@/lib/membership/session-diagnostic";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const started = Date.now();
  let stage = "membership";
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const membership = await getMembership();
    const diagnostic = membership.status === "signed-out" ? sessionDiagnostic(request.headers) : undefined;
    if (diagnostic) console.warn(JSON.stringify({ event: "membership-session-unverified", ...diagnostic, elapsedMs: Date.now() - started }));
    stage = "display-cookie";
    await saveMemberDisplay(membership.status === "signed-in" ? { ...membership, owner: membership.isAdmin } : undefined);
    return Response.json({ ...(diagnostic ? {diagnostic} : {}), adminMfaRequired: "adminMfaRequired" in membership && membership.adminMfaRequired, status: membership.status, plan: membership.plan, accessExpiresAt: "accessExpiresAt" in membership ? membership.accessExpiresAt : 0, isAdmin: "isAdmin" in membership && membership.isAdmin, ownerMode: "ownerMode" in membership && membership.ownerMode, ownerAccount: "ownerAccount" in membership && membership.ownerAccount === true, canTest: "canTest" in membership && membership.canTest, testing: "testing" in membership && membership.testing }, { headers });
  } catch {
    console.error(JSON.stringify({ event: "membership-check-failed", stage, elapsedMs: Date.now() - started }));
    return Response.json({ status: "unavailable", plan: "free" }, { status: 503, headers });
  }
}
