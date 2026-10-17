import { auth } from "@clerk/nextjs/server";
import { membershipConfigured } from "@/lib/membership/server";
import { canReviewResolute } from "@/lib/resolute/review-policy";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
 try {
  if (!membershipConfigured()) return Response.json({ allowed: false }, { status: 503, headers });
  const { userId } = await auth();
  if (!userId) return Response.json({ allowed: false }, { status: 401, headers });
  const allowed = canReviewResolute(userId, process.env.VERCEL_ENV);
  return Response.json({ allowed }, { status: allowed ? 200 : 403, headers });
 } catch { return Response.json({ allowed: false }, { status: 503, headers }); }
}
