import "server-only";
import {liveMembership} from "@/services/tech-phase-billing/live-membership.mjs";
import { cache } from "react";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { adminMfaAllowed } from "./admin-mfa";
import { isOwnerAccount, ownerPreviewMode, previewPlan, productionOwnerMode, resolveAdmin, resolvePlan } from "./entitlements";
export function membershipConfigured() {
  return Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}
export const getMembership = cache(async function getMembership() {
  if (!membershipConfigured()) return { status: "unavailable", plan: "free" } as const;
  const { userId, sessionClaims } = await auth();
  if (!userId) return { status: "signed-out", plan: "free" } as const;
  return getMembershipForUser(userId, sessionClaims);
});

/** Internal server-to-server use only; callers must authenticate before selecting an ID. */
export async function getMembershipForUser(userId: string, sessionClaims?: unknown) {
  // Private metadata cannot be edited by the member. Never trust browser plan claims.
  const user = await (await clerkClient()).users.getUser(userId);
  const adminCandidate = resolveAdmin(userId, user.privateMetadata);
  const adminMfaRequired = adminCandidate && process.env.TECH_PHASE_REQUIRE_ADMIN_MFA === "true" && !adminMfaAllowed(user.twoFactorEnabled, sessionClaims);
  const isAdmin = adminCandidate && !adminMfaRequired;
  const productionOwner = productionOwnerMode(userId, isAdmin, process.env.VERCEL_ENV);
  // Only the approved, MFA-verified production owner may use the existing self-preview.
  const testPlan = previewPlan(user.privateMetadata, isAdmin, productionOwner ? "preview" : process.env.VERCEL_ENV);
  const ownerMode = (productionOwner && testPlan === null) || ownerPreviewMode(user.privateMetadata, isAdmin, process.env.VERCEL_ENV);
  const test = user.privateMetadata.membershipPreview as Record<string, string> | undefined;
  // Owner access is operational access, not a paid subscription or payment receipt.
  const live=productionOwner ? null : await liveMembership(process.env,userId);
  const accessExpiresAt = live ? live.accessExpiresAt : ownerMode ? Date.now() + 3_600_000 : testPlan !== null ? Math.min(Date.parse(test?.proExpiresAt ?? ""), Date.parse(test?.testUntil ?? "")) : Date.parse(String(user.privateMetadata.proExpiresAt ?? ""));
  return { accessExpiresAt: Number.isFinite(accessExpiresAt) ? accessExpiresAt : 0, status: "signed-in", plan: live ? live.plan : ownerMode ? "pro" : testPlan ?? resolvePlan(user.privateMetadata), userId, isAdmin, ownerMode, adminMfaRequired,
    // Owner label: the approved account itself, unless it is previewing a member plan.
    ownerAccount: isOwnerAccount(userId) && testPlan === null,
    canTest: isAdmin && process.env.VERCEL_ENV === "preview", testing: testPlan !== null } as const;
}
