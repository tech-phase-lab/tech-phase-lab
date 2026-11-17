import { isOwnerAccount } from "../membership/entitlements.ts";

/** RESOLUTE ③④ by phone notification (owner, Nov 17). Who may turn this device's notifications on, and for what:
 * - Tech Phase PRO: every Tech Phase notice, as before (and the RESOLUTE row too when the member bought RESOLUTE).
 * - RESOLUTE buyer (use + alerts rights), PRO or not: the RESOLUTE notices. A FREE member with RESOLUTE gets only those.
 * - Owner accounts (OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID): both, in every environment.
 * Always decided on the server (the member's session, RESOLUTE's own entitlement answer); nothing from the browser counts. */

/** The owner's RESOLUTE window: renewed each time the owner opens a page that asks (seconds from now). */
export const OWNER_RESOLUTE_WINDOW_SECONDS = 30 * 86400;
/** How long the settings page waits for RESOLUTE's answer before treating it as "could not check". */
export const RESOLUTE_CHECK_TIMEOUT_MS = 5000;

type Snapshot = { canReceiveNotifications: boolean; alerts: { status: string; expiresAt: string | null }; accessBasis?: unknown };

/** End of the member's RESOLUTE alert rights in epoch seconds; 0 when they have none; undefined when RESOLUTE could not be asked. */
export async function resoluteNotificationUntil(userId: string, read: () => Promise<Snapshot>, now = Date.now(),
  timeoutMs = RESOLUTE_CHECK_TIMEOUT_MS): Promise<number | undefined> {
  if (isOwnerAccount(userId)) return Math.floor(now / 1000) + OWNER_RESOLUTE_WINDOW_SECONDS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snapshot = await Promise.race([read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); })]);
    if (!snapshot.canReceiveNotifications) return 0;
    if (snapshot.accessBasis === "owner") return Math.floor(now / 1000) + OWNER_RESOLUTE_WINDOW_SECONDS;
    const until = Date.parse(snapshot.alerts.expiresAt ?? "");
    return Number.isFinite(until) && until > now ? until / 1000 : 0;
  } catch { return undefined; } finally { clearTimeout(timer); }
}

export type PushAccess = { pro: boolean; resoluteUntil: number | undefined };
/** "pro-required" (neither), "unavailable" (no PRO and RESOLUTE could not be asked), or the access. */
export function pushAccessDecision(access: PushAccess, now = Date.now()): "allowed" | "pro-required" | "unavailable" {
  if (access.pro) return "allowed";
  if (access.resoluteUntil === undefined) return "unavailable";
  return access.resoluteUntil * 1000 > now ? "allowed" : "pro-required";
}
export const hasResolute = (access: PushAccess, now = Date.now()) => access.resoluteUntil !== undefined && access.resoluteUntil * 1000 > now;

/** What a member without PRO may save: the RESOLUTE row only. */
export function resoluteOnlyPreferences(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => key === "resolute");
}
