import { getMembership } from "@/lib/membership/server";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const membership = await getMembership();
    return Response.json({ status: membership.status, plan: membership.plan, isAdmin: "isAdmin" in membership && membership.isAdmin, canTest: "canTest" in membership && membership.canTest, testing: "testing" in membership && membership.testing }, { headers });
  } catch {
    return Response.json({ status: "unavailable", plan: "free" }, { status: 503, headers });
  }
}
