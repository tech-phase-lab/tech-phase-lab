import { auth } from "@clerk/nextjs/server";
import { membershipConfigured } from "@/lib/membership/server";
import { createNotificationRoutes } from "@/lib/resolute/notification-route";
import { fetchNotificationSettings } from "@/lib/resolute/notification-http";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const routes=createNotificationRoutes({
 async session(){if(!membershipConfigured())throw new Error("Authentication unavailable");
  const session=await auth();if(!session.userId)return null;
  const token=await session.getToken();if(!token)throw new Error("Authentication unavailable");return token;},
 forward:(token,method,mutation)=>fetchNotificationSettings(token,process.env.RESOLUTE_API_URL,process.env.RESOLUTE_API_SERVICE_TOKEN,method,mutation),
});
export const GET=routes.GET;
export const PUT=routes.PUT;
