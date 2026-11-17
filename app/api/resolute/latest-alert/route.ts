import { auth } from "@clerk/nextjs/server";
import { membershipConfigured } from "@/lib/membership/server";
import { fetchLatestAlert } from "@/lib/resolute/latest-alert";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
/** 「今日のお知らせ」: the signed-in member's newest delivered ③ alert, through resolute-api with the member's own session. */
export async function GET(request: Request) {
  if (new URL(request.url).search) return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
  try {
    if (!membershipConfigured()) throw new Error("Authentication unavailable");
    const session = await auth();
    if (!session.userId) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401, headers });
    const token = await session.getToken();
    if (!token) throw new Error("Authentication unavailable");
    const result = await fetchLatestAlert(token, process.env.RESOLUTE_API_URL, process.env.RESOLUTE_API_SERVICE_TOKEN);
    return Response.json(result.body, { status: result.status, headers });
  } catch { return Response.json({ error: "LATEST_ALERT_UNAVAILABLE" }, { status: 503, headers }); }
}
