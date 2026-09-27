import "server-only";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { resolvePlan } from "./entitlements";
export function membershipConfigured() {
  return Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}
export async function getMembership() {
  if (!membershipConfigured()) return { status: "unavailable", plan: "free" } as const;
  const { userId } = await auth();
  if (!userId) return { status: "signed-out", plan: "free" } as const;
  // Private metadata cannot be edited by the member. Never trust browser plan claims.
  const user = await (await clerkClient()).users.getUser(userId);
  return { status: "signed-in", plan: resolvePlan(user.privateMetadata), userId } as const;
}
