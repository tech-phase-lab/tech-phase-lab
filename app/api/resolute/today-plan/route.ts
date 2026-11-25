import { auth } from "@clerk/nextjs/server";
import { membershipConfigured } from "@/lib/membership/server";
import { fetchTodayPlan, todayPlanEnabled } from "@/lib/resolute/today-plan-transport";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
/** 「今日やること」: the signed-in member's stored TodayPlan for the latest U.S. close, through resolute-api with the member's own session.
 * Off (503) unless RESOLUTE_TODAY_PLAN_ENABLED=true; the screen then shows fixedTodayPlan, as it does for {plan:null}. */
export async function GET(request: Request) {
  if (new URL(request.url).search) return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
  if (!todayPlanEnabled()) return Response.json({ error: "TODAY_PLAN_UNAVAILABLE" }, { status: 503, headers });
  try {
    if (!membershipConfigured()) throw new Error("Authentication unavailable");
    const session = await auth();
    if (!session.userId) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401, headers });
    const token = await session.getToken();
    if (!token) throw new Error("Authentication unavailable");
    const result = await fetchTodayPlan(token, process.env.RESOLUTE_API_URL, process.env.RESOLUTE_API_SERVICE_TOKEN);
    return Response.json(result.body, { status: result.status, headers });
  } catch { return Response.json({ error: "TODAY_PLAN_UNAVAILABLE" }, { status: 503, headers }); }
}
