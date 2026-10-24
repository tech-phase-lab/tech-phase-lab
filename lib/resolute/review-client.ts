export type ReviewAccess = "allowed" | "denied" | "unavailable";
export type ReviewSessionToken = (options?: { skipCache?: boolean }) => Promise<string | null>;
/** Refresh the Clerk session before checking access; a stale mobile cookie is not a sign-out. */
export async function requestReviewAccess(getToken?: ReviewSessionToken, signal?: AbortSignal,
 fetcher: typeof fetch = fetch): Promise<ReviewAccess> {
 try {
  const token = getToken ? await getToken({ skipCache: true }) : undefined;
  if (signal?.aborted) return "unavailable";
  if (getToken && !token) return "unavailable";
  const response = await fetcher("/api/resolute/review-access", { cache:"no-store",credentials:"same-origin",redirect:"error",
   signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
   ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) });
  if ([401,403].includes(response.status)) return "denied";
  if (!response.ok) return "unavailable";
  return (await response.json()).allowed === true ? "allowed" : "denied";
 } catch { return "unavailable"; }
}
