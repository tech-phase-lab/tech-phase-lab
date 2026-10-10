import { auth } from "@clerk/nextjs/server";
import { membershipConfigured } from "@/lib/membership/server";
import { getResoluteEntitlementsForSession } from "@/lib/resolute/server";

import { ResoluteRateLimited } from "@/lib/resolute/transport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    if (!membershipConfigured()) throw new Error("Authentication unavailable");
    const { userId, getToken } = await auth();
    if (!userId) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401, headers });
    const token = await getToken();
    if (!token) throw new Error("Authentication unavailable");
    return Response.json(await getResoluteEntitlementsForSession(token), { headers });
  } catch (error) {
    if (error instanceof ResoluteRateLimited) return Response.json({ error: "RATE_LIMITED" },
      { status: 429, headers: { ...headers, "Retry-After": "60" } });
    // DB/auth errors must not become a missing purchase or reveal secrets.
    return Response.json({ error: "ENTITLEMENT_UNAVAILABLE" }, { status: 503, headers });
  }
}
