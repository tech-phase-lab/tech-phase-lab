/** Only call with metadata fetched from the identity provider on the server. */
export function resolvePlan(metadata: Record<string, unknown>, now = Date.now()): "free" | "pro" {
  const expires = typeof metadata.proExpiresAt === "string" ? Date.parse(metadata.proExpiresAt) : NaN;
  return metadata.plan === "pro" && Number.isFinite(expires) && expires > now ? "pro" : "free";
}

/** Server use only: userId must come from a verified Clerk session, never request input. */
export function resolveAdmin(userId: string | null | undefined, metadata: Record<string, unknown>): boolean {
  if (!userId) return false;
  // Explicitly approved owner account; identifier is not a credential.
  return userId === "user_3JulL4D07KtVl5Eg2zdY1iczKbC" || metadata.role === "admin";
}

/** Preview-only override for an authenticated administrator; never used in production. */
export function previewPlan(metadata: Record<string, unknown>, isAdmin: boolean, environment: string | undefined, now = Date.now()) {
  const test = metadata.membershipPreview;
  if (!isAdmin || environment !== "preview" || !test || typeof test !== "object") return null;
  const value = test as Record<string, unknown>;
  const until = typeof value.testUntil === "string" ? Date.parse(value.testUntil) : NaN;
  if (!Number.isFinite(until) || until <= now) return null;
  return resolvePlan(value, now);
}

/** Verified administrators start in owner mode on the development preview only. */
export function ownerPreviewMode(metadata: Record<string, unknown>, isAdmin: boolean, environment: string | undefined, now = Date.now()) {
  return isAdmin && environment === "preview" && previewPlan(metadata, isAdmin, environment, now) === null;
}
