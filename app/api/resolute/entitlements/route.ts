import { auth } from "@clerk/nextjs/server";
import { membershipConfigured } from "@/lib/membership/server";
import { getResoluteEntitlementsForUser } from "@/lib/resolute/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    if (!membershipConfigured()) throw new Error("Authentication unavailable");
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401, headers });
    return Response.json(await getResoluteEntitlementsForUser(userId), { headers });
  } catch {
    // DB/auth errors must not become a missing purchase or reveal secrets.
    return Response.json({ error: "ENTITLEMENT_UNAVAILABLE" }, { status: 503, headers });
  }
}
