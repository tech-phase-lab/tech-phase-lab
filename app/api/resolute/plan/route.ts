import { auth } from "@clerk/nextjs/server";
import { membershipConfigured } from "@/lib/membership/server";
import { createPlanRoutes } from "@/lib/resolute/plan-route";
import { fetchResolutePlan } from "@/lib/resolute/plan-transport";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const routes = createPlanRoutes({
  async session() {
    if (!membershipConfigured()) throw new Error("Authentication unavailable");
    const session = await auth(); if (!session.userId) return null;
    const token = await session.getToken(); if (!token) throw new Error("Authentication unavailable"); return token;
  },
  forward: (token, method, mutation) => fetchResolutePlan(token, process.env.RESOLUTE_API_URL,
    process.env.RESOLUTE_API_SERVICE_TOKEN, method, mutation),
});
export const GET = routes.GET;
export const PUT = routes.PUT;
export const DELETE = routes.DELETE;
