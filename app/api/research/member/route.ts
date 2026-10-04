import { saveMemberDisplay } from "@/lib/membership/display-server";
import { getMembership } from "@/lib/membership/server";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const membership = await getMembership();
    await saveMemberDisplay(membership.status === "signed-in" ? { ...membership, owner: membership.isAdmin } : undefined);
    return Response.json({ status: membership.status, plan: membership.plan, accessExpiresAt: "accessExpiresAt" in membership ? membership.accessExpiresAt : 0, isAdmin: "isAdmin" in membership && membership.isAdmin, ownerMode: "ownerMode" in membership && membership.ownerMode, canTest: "canTest" in membership && membership.canTest, testing: "testing" in membership && membership.testing }, { headers });
  } catch {
    return Response.json({ status: "unavailable", plan: "free" }, { status: 503, headers });
  }
}
