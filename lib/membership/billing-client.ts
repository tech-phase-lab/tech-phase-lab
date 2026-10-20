// Browser-facing protocol only; no provider credentials or membership writes.
export type BillingSubscription = { id: string; currency: "JPY" | "USD"; state: string };
export type BillingSummary = { environment: "sandbox"; plan: "free" | "pro"; proExpiresAt: string | null; subscription: BillingSubscription | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function sandboxApproval(value: unknown): string {
  if (typeof value !== "string") throw Error("billing-unavailable");
  const url = new URL(value);
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
    !(v.proExpiresAt === null || (typeof v.proExpiresAt === "string" && Number.isFinite(Date.parse(v.proExpiresAt)))) ||
    !(v.subscription === null || (v.subscription && uuid.test(v.subscription.id) && ["JPY", "USD"].includes(v.subscription.currency) &&
      ["creating", "approval_pending", "active", "suspended", "cancelled", "expired"].includes(v.subscription.state)))) throw Error("billing-unavailable");
  return v;
}
export async function billingRequest(action: string, body?: Record<string, unknown>, signal?: AbortSignal) {
  if (!["readiness", "status", "create", "reconcile", "cancel"].includes(action)) throw Error("input");
  const response = await fetch(`/api/research/billing/sandbox/${action}`, {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  if (!response.ok) throw Error(typeof result?.error === "string" ? result.error : "billing-unavailable");
  return result;
}
