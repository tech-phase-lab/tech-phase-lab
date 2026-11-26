import { auth } from "@clerk/nextjs/server";
import { membershipConfigured } from "@/lib/membership/server";
import { postTonight } from "@/lib/resolute/tonight-transport";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
/** 今夜のひと息: the signed-in member's rough-night record and tonight's questions, and the morning note's answer
 * (lib/resolute/tonight-database.ts), through resolute-api with the member's own session. */
export async function POST(request: Request) {
  // Same-origin writes only, like the plan route.
  if (new URL(request.url).search || request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
  try {
    const body = await request.text();
    if (body.length > 1024) return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
    if (!membershipConfigured()) throw new Error("Authentication unavailable");
    const session = await auth();
    if (!session.userId) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401, headers });
    const token = await session.getToken();
    if (!token) throw new Error("Authentication unavailable");
    const result = await postTonight(token, process.env.RESOLUTE_API_URL, process.env.RESOLUTE_API_SERVICE_TOKEN, body);
    return Response.json(result.body, { status: result.status, headers });
  } catch { return Response.json({ error: "TONIGHT_UNAVAILABLE" }, { status: 503, headers }); }
}
