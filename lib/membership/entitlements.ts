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
