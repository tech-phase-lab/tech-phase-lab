import { hasOwnerAccess, type OwnerAccess } from "./owner-access.ts";
import { entitlementSource, readEntitlementSnapshot, type EntitlementSource } from "./entitlement-source.ts";
import { Pool } from "pg";
import { resoluteDatabaseConfig } from "./database-config.ts";
import { NotificationAccessDenied } from "./notification-database.ts";
import { latestAlertFromDigest, type LatestAlertSnapshot } from "./latest-alert.ts";

/** 「今日のお知らせ」: the member's newest ③ alert that was actually delivered (accepted by the phone or the mail service).
 * Read-only, the signed-in member's own row only, with the same right as the settings screen (use active, or the owner). */
export function createLatestAlertStore(pool: Pick<Pool, "query">, source: EntitlementSource = entitlementSource()) {
  return async (userId: string, ownerAccess?: OwnerAccess): Promise<LatestAlertSnapshot> => {
    if (!/^user_[A-Za-z0-9]{1,128}$/.test(userId)) throw new Error("Invalid identity");
    if (!hasOwnerAccess(ownerAccess, userId)) {
      const allowed = source === "live" ? (await readEntitlementSnapshot(pool, userId, source)).view.canUseTools
        : (await pool.query(`SELECT 1 FROM resolute.entitlements WHERE clerk_user_id=$1 AND product_id='resolute_v1' AND kind='use'
           AND revoked_at IS NULL AND starts_at<=statement_timestamp() AND expires_at IS NULL`, [userId])).rowCount === 1;
      if (!allowed) throw new NotificationAccessDenied();
    }
    const row = (await pool.query(`SELECT payload->'digest'->'payload' AS digest FROM resolute.notification_outbox
      WHERE clerk_user_id=$1 AND kind='alerts' AND accepted_at IS NOT NULL ORDER BY delivery_date_jst DESC, accepted_at DESC LIMIT 1`, [userId])).rows[0];
    return { alert: row ? latestAlertFromDigest(row.digest) : null };
  };
}
let store: ReturnType<typeof createLatestAlertStore> | undefined;
/** Same switch, database and scoped role as the notification settings (RESOLUTE_NOTIFICATION_API_ENABLED, RESOLUTE_NOTIFICATION_DB_URL);
 * the role needs SELECT on notification_outbox (db/resolute/024_latest_alert_reader.sql). */
export async function operateLatestAlert(userId: string, ownerAccess?: OwnerAccess) {
  if (process.env.RESOLUTE_NOTIFICATION_API_ENABLED !== "true") throw new Error("Notification API not enabled");
  if (!store) {
    const config = resoluteDatabaseConfig(process.env.RESOLUTE_NOTIFICATION_DB_URL);
    if (new URL(config.connectionString).username !== "resolute_notification_writer") throw new Error("Scoped writer required");
    const pool = new Pool(config); pool.on("error", () => {}); store = createLatestAlertStore(pool, entitlementSource());
  }
  return store(userId, ownerAccess);
}
