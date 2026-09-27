import "server-only";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { previewPlan, resolveAdmin, resolvePlan } from "./entitlements";
export function membershipConfigured() {
  return Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}
export async function getMembership() {
  if (!membershipConfigured()) return { status: "unavailable", plan: "free" } as const;
  const { userId } = await auth();
  if (!userId) return { status: "signed-out", plan: "free" } as const;
  // Private metadata cannot be edited by the member. Never trust browser plan claims.
  const user = await (await clerkClient()).users.getUser(userId);
  const isAdmin = resolveAdmin(userId, user.privateMetadata);
  const testPlan = previewPlan(user.privateMetadata, isAdmin, process.env.VERCEL_ENV);
  return { status: "signed-in", plan: testPlan ?? resolvePlan(user.privateMetadata), userId, isAdmin,
    canTest: isAdmin && process.env.VERCEL_ENV === "preview", testing: testPlan !== null } as const;
}
