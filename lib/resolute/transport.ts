import { RESOLUTE_PRODUCT_ID, type EntitlementView } from "./entitlements.ts";

const statuses = new Set(["missing", "scheduled", "active", "expired", "revoked"]);
function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}
function validView(value: unknown, kind: "use" | "alerts"): value is EntitlementView {
  if (!value || typeof value !== "object") return false;
  const v = value as EntitlementView;
  if (!statuses.has(v.status)) return false;
  if (v.status === "missing") return v.startsAt === null && v.expiresAt === null;
  return validDate(v.startsAt) && (kind === "use" ? v.expiresAt === null
    : validDate(v.expiresAt) && Date.parse(v.expiresAt) > Date.parse(v.startsAt));
}
export function validateSnapshot(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Invalid entitlement response");
  const v = value as { productId: string; asOf: string; use: EntitlementView;
    alerts: EntitlementView; canUseTools: boolean; canReceiveNotifications: boolean };
  if (v.productId !== RESOLUTE_PRODUCT_ID || !validDate(v.asOf) ||
      !validView(v.use, "use") || !validView(v.alerts, "alerts") ||
      v.canUseTools !== (v.use.status === "active") ||
      v.canReceiveNotifications !== (v.use.status === "active" && v.alerts.status === "active")) {
    throw new Error("Invalid entitlement response");
  }
  return { productId: v.productId, asOf: v.asOf, use: {
    status: v.use.status, startsAt: v.use.startsAt, expiresAt: v.use.expiresAt }, alerts: {
    status: v.alerts.status, startsAt: v.alerts.startsAt, expiresAt: v.alerts.expiresAt },
    canUseTools: v.canUseTools, canReceiveNotifications: v.canReceiveNotifications };
}
export class ResoluteRateLimited extends Error {}

export async function fetchResoluteEntitlements(token: string, base: string | undefined,
  secret: string | undefined, request: typeof fetch = fetch) {
  if (!base || !secret || secret.length < 43 || !token || token.length > 16384) {
    throw new Error("RESOLUTE connection unavailable");
  }
  const url = new URL(base);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/" || !url.hostname.endsWith(".up.railway.app")) {
    throw new Error("Invalid RESOLUTE endpoint");
  }
  url.pathname = "/internal/v1/entitlements";
  const deadline = Date.now() + 20000;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await request(url, { method: "GET", cache: "no-store", redirect: "error",
        headers: { Authorization: `Bearer ${token}`, "X-Resolute-Service-Token": secret,
          Accept: "application/json" },
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    } catch {
      if (attempt === 0 && Date.now() < deadline) continue;
      throw new Error("RESOLUTE connection unavailable");
    }
    if (res.status === 429) { await res.body?.cancel(); throw new ResoluteRateLimited(); }
    if ((res.status === 502 || res.status === 503) && attempt === 0 && Date.now() < deadline) {
      await res.body?.cancel(); continue;
    }
    if (!res.ok || !res.headers.get("content-type")?.startsWith("application/json")) {
      await res.body?.cancel(); throw new Error("RESOLUTE connection unavailable");
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Missing entitlement response");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 8192) throw new Error("Oversize entitlement response");
        chunks.push(value);
      }
    } catch { await reader.cancel(); throw new Error("Invalid entitlement response"); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return validateSnapshot(JSON.parse(new TextDecoder().decode(bytes)));
  }
  throw new Error("RESOLUTE connection unavailable");
}
