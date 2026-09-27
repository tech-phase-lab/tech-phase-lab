/** Only call with metadata fetched from the identity provider on the server. */
export function resolvePlan(metadata: Record<string, unknown>, now = Date.now()): "free" | "pro" {
  const expires = typeof metadata.proExpiresAt === "string" ? Date.parse(metadata.proExpiresAt) : NaN;
  return metadata.plan === "pro" && Number.isFinite(expires) && expires > now ? "pro" : "free";
}
