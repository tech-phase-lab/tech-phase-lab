/**
 * Whether ③④ notifications are really being delivered (go-live audit, Nov 25). resolute-api derives it from the same
 * switches the delivery cron reads (notification-queue.mjs / mail-worker.mjs), so the 「通知の配信は準備中です」 line on
 * the alerts/morning screens disappears by itself once delivery is switched on — no screen edit later.
 * While the owner-only test allowlist is set, delivery is live only for those accounts. Booleans only; no values leave.
 */
export const NOTIFICATION_DELIVERY_HEADER = "x-resolute-notification-delivery";
export function notificationDeliveryLive(env: Record<string, string | undefined>, userId: string): boolean {
 if (env.RESOLUTE_NOTIFICATION_QUEUE_ENABLED !== "true" || env.RESOLUTE_MAIL_DELIVERY_ENABLED !== "true") return false;
 const only = (env.RESOLUTE_NOTIFICATION_QUEUE_ONLY_USER_IDS ?? "").split(",").map(v => v.trim()).filter(Boolean);
 return !only.length || only.includes(userId);
}
