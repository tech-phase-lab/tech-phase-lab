import "server-only";
import { cache } from "react";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { ownerPreviewMode, previewPlan, resolveAdmin, resolvePlan } from "./entitlements";
export function membershipConfigured() {
  return Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}
export const getMembership = cache(async function getMembership() {
  if (!membershipConfigured()) return { status: "unavailable", plan: "free" } as const;
  const { userId } = await auth();
  if (!userId) return { status: "signed-out", plan: "free" } as const;
  return getMembershipForUser(userId);
});

/** Internal server-to-server use only; callers must authenticate before selecting an ID. */
export async function getMembershipForUser(userId: string) {
  // Private metadata cannot be edited by the member. Never trust browser plan claims.
  const user = await (await clerkClient()).users.getUser(userId);
  const isAdmin = resolveAdmin(userId, user.privateMetadata);
  const testPlan = previewPlan(user.privateMetadata, isAdmin, process.env.VERCEL_ENV);
  const ownerMode = ownerPreviewMode(user.privateMetadata, isAdmin, process.env.VERCEL_ENV);
  const test = user.privateMetadata.membershipPreview as Record<string, string> | undefined;
  const accessExpiresAt = ownerMode ? Date.now() + 3_600_000 : testPlan !== null ? Math.min(Date.parse(test?.proExpiresAt ?? ""), Date.parse(test?.testUntil ?? "")) : Date.parse(String(user.privateMetadata.proExpiresAt ?? ""));
  return { accessExpiresAt: Number.isFinite(accessExpiresAt) ? accessExpiresAt : 0, status: "signed-in", plan: ownerMode ? "pro" : testPlan ?? resolvePlan(user.privateMetadata), userId, isAdmin, ownerMode,
    canTest: isAdmin && process.env.VERCEL_ENV === "preview", testing: testPlan !== null } as const;
}
