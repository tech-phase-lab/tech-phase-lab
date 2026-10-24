export type CheckoutLanguage = "ja" | "en";
export type LiveOrder = {
 orderId: string; sandbox: false; state: string; expiresAt: string; approvalUrl?: string | null;
 quote: { kind: "initial" | "renewal"; language: CheckoutLanguage; currency: "JPY" | "USD"; value: string; priceClass: string };
};
export function checkoutUrl(language: CheckoutLanguage, orderId?: string | null, cancelled = false) {
 const query = new URLSearchParams({lang: language});
 if (orderId) query.set("order", orderId);
 if (cancelled) query.set("cancel", "1");
 return `/resolute/checkout?${query}`;
}
export function liveApprovalUrl(value: unknown): string | null {
 return typeof value === "string" && /^https:\/\/www\.paypal\.com\/checkoutnow\?token=[A-Z0-9]{8,32}$/.test(value) ? value : null;
}
export function liveOrder(value: unknown): LiveOrder {
 const o = value as LiveOrder;
 if (!o || o.sandbox !== false || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(o.orderId) ||
  !["creating","created","capturing","paid","held","suspended","revoked"].includes(o.state) || !Number.isFinite(Date.parse(o.expiresAt)) ||
  !o.quote || !["initial","renewal"].includes(o.quote.kind) || !["ja","en"].includes(o.quote.language) ||
  o.quote.currency !== (o.quote.language === "ja" ? "JPY" : "USD") ||
  typeof o.quote.value !== "string" || !/^\d+(?:\.\d{2})?$/.test(o.quote.value) || Number(o.quote.value) <= 0 ||
  (o.approvalUrl != null && !liveApprovalUrl(o.approvalUrl))) throw Error("PAYMENT_UNAVAILABLE");
 return o;
}
export async function liveCheckoutRequest(path: string, body?: object) {
 if (!["orders","capture","access"].includes(path) && !/^orders\/[0-9a-f-]{36}$/i.test(path)) throw Error("INVALID_PAYMENT_INPUT");
 const response = await fetch(`/api/resolute/live-payments/${path}`, {
  method: body ? "POST" : "GET", cache: "no-store", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(25000),
  ...(body ? {headers:{"Content-Type":"application/json"},body:JSON.stringify(body)} : {}),
 });
 const data = await response.json();
 if (!response.ok) throw Error(typeof data.error === "string" ? data.error : "PAYMENT_UNAVAILABLE");
 if (path !== "access" && data.sandbox !== false) throw Error("PAYMENT_UNAVAILABLE");
 return data;
}
