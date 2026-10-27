/** Claims must come from Clerk's verified server auth(), never request JSON. */
export function adminMfaAllowed(enrolled: boolean, claims: unknown): boolean {
  if (!enrolled || !claims || typeof claims !== "object") return false;
  const fva = (claims as { fva?: unknown }).fva;
  return Array.isArray(fva) && fva.length === 2 && typeof fva[1] === "number" && Number.isFinite(fva[1]) && fva[1] >= 0;
}
