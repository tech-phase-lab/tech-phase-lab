// Browser-facing protocol only; no provider credentials or membership writes.
export type BillingSubscription = { id: string; currency: "JPY" | "USD"; state: string };
export type BillingSummary = { environment: "sandbox"; plan: "free" | "pro"; proExpiresAt: string | null; subscription: BillingSubscription | null; reviewRequired?: boolean };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function sandboxApproval(value: unknown): string {
  if (typeof value !== "string") throw Error("billing-unavailable");
  let url: URL;
  try { url = new URL(value); } catch { throw Error("billing-unavailable"); }
  if (url.origin !== "https://www.sandbox.paypal.com" || url.pathname !== "/webapps/billing/subscriptions" ||
    url.username || url.password || url.hash || [...url.searchParams].length !== 1 ||
    !/^BA-[A-Z0-9]{8,64}$/.test(url.searchParams.get("ba_token") ?? "")) throw Error("billing-unavailable");
  return url.href;
}
export function billingReturn(search: string) {
  const params = new URLSearchParams(search), ids = params.getAll("billing");
  return { id: ids.length === 1 && uuid.test(ids[0]) ? ids[0] : null, cancelled: params.get("cancel") === "1" };
}
export function billingSummary(value: unknown): BillingSummary {
  const v = value as BillingSummary;
  if (!v || v.environment !== "sandbox" || !["free", "pro"].includes(v.plan) ||
    (v.reviewRequired !== undefined && typeof v.reviewRequired !== "boolean") ||
    (v.reviewRequired === true && !v.subscription) ||
    (v.plan === "pro" ? v.proExpiresAt === null : v.proExpiresAt !== null) ||
    !(v.proExpiresAt === null || (typeof v.proExpiresAt === "string" && Number.isFinite(Date.parse(v.proExpiresAt)))) ||
    !(v.subscription === null || (v.subscription && uuid.test(v.subscription.id) && ["JPY", "USD"].includes(v.subscription.currency) &&
      ["creating", "approval_pending", "active", "suspended", "cancelled", "expired"].includes(v.subscription.state)))) throw Error("billing-unavailable");
  return v;
}
// A return URL is only a hint to reconcile the already authenticated member's
// persisted contract. It never creates a purchase or grants access itself.
export async function verifyBillingReturn(
  returned: ReturnType<typeof billingReturn>, current: BillingSummary,
  signal: AbortSignal, request = billingRequest,
) {
  const sub = current.subscription;
  if (signal.aborted || returned.cancelled || !returned.id || returned.id !== sub?.id ||
      current.plan === "pro" || current.reviewRequired ||
      !["approval_pending", "active", "suspended"].includes(sub.state)) return null;
  let review = false;
  try {
    const result = await request("reconcile", { id: sub.id }, signal);
    review = result.status === "review-required";
  } catch (error) {
    if (signal.aborted) throw error;
    // An interrupted response is not proof of failed payment. Do not retry the
    // mutation; read the durable result, including concurrent webhook updates.
    review = error instanceof Error && error.message === "settlement-review-required";
  }
  if (signal.aborted) return null;
  const next = billingSummary(await request("status", undefined, signal));
  if (signal.aborted) return null;
  if (next.subscription?.id !== sub.id) throw Error("billing-unavailable");
  return { summary: next, notice: next.reviewRequired || review ? "review" : next.plan === "pro" ? "verified" : "pending" };
}
export async function billingRequest(action: string, body?: Record<string, unknown>, signal?: AbortSignal) {
  if (!["readiness", "status", "create", "reconcile", "cancel"].includes(action)) throw Error("input");
  const response = await fetch(`/api/research/billing/sandbox/${action}`, {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
  });
  // A paused deployment/proxy may return HTML instead of the billing protocol.
  // Bound the body and never surface arbitrary upstream text to the UI.
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    await response.body?.cancel().catch(() => {});
    throw Error("billing-unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("billing-unavailable");
  let result;
  try {
    const chunks: Uint8Array[] = []; let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16_384) throw Error("billing-unavailable");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    result = JSON.parse(new TextDecoder().decode(bytes));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw Error("billing-unavailable");
  } catch {
    await reader.cancel().catch(() => {});
    throw Error("billing-unavailable");
  } finally { reader.releaseLock(); }
  if (!response.ok) throw Error(typeof result?.error === "string" ? result.error : "billing-unavailable");
  // HTTP success alone is not evidence that renewal was stopped. A malformed
  // response must take the existing read-only recovery path, never show success.
  if (action === "cancel" && result.status !== "cancelled") throw Error("billing-unavailable");
  if (action === "create") {
    if (typeof result.id !== "string" || !uuid.test(result.id)) throw Error("billing-unavailable");
    if (result.approvalUrl !== null && result.approvalUrl !== undefined) {
      sandboxApproval(result.approvalUrl);
    } else if (!["APPROVED", "ACTIVE", "SUSPENDED", "CANCELLED", "EXPIRED"].includes(result.status)) {
      throw Error("billing-unavailable");
    }
  }
  if (action === "reconcile") {
    if (!["verified", "payment-pending", "review-required"].includes(result.status)) throw Error("billing-unavailable");
    billingSummary({ ...result, subscription: null });
  }
  return result;
}
