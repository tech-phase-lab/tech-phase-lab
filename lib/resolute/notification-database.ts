import {hasOwnerAccess,type OwnerAccess} from './owner-access.ts';
import { protectionRuntime } from "./protection-runtime.ts";
import type { ProtectionBarrier } from "./protection-outbox.ts";
import { entitlementSource, readEntitlementSnapshot, type EntitlementSource } from "./entitlement-source.ts";
import { Pool, type PoolClient } from "pg";
import { resoluteDatabaseConfig } from "./database-config.ts";
import { defaultNotificationSettings, parseNotificationMutation, parseNotificationSnapshot,
 type NotificationSnapshot, type NotificationSettings } from "./notification-settings.ts";
export class NotificationAccessDenied extends Error {}
export class NotificationConflict extends Error {
 readonly snapshot: NotificationSnapshot;
 constructor(snapshot: NotificationSnapshot) { super("REVISION_CONFLICT"); this.snapshot=snapshot; }
}
export function createNotificationStore(pool: Pick<Pool,"connect">, source: EntitlementSource = entitlementSource(), protect?: ProtectionBarrier) {
 return async (userId: string, method: "GET"|"PUT", mutation?: {settings:NotificationSettings;baseRevision:number}, ownerAccess?:OwnerAccess) => {
  if(!/^user_[A-Za-z0-9]{1,128}$/.test(userId)) throw new Error("Invalid identity");
  const parsed=method==="PUT"?parseNotificationMutation(mutation):undefined;
  const client:PoolClient=await pool.connect();
  try {
   if(protect) await protect(client,userId);
   await client.query("BEGIN");
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",[userId]);
   const rights=hasOwnerAccess(ownerAccess,userId)?{rowCount:1}:source==="live"?{rowCount:(await readEntitlementSnapshot(client,userId,source)).view.canUseTools?1:0}:await client.query(`SELECT 1 FROM resolute.entitlements WHERE clerk_user_id=$1
    AND product_id='resolute_v1' AND kind='use' AND revoked_at IS NULL
    AND starts_at<=statement_timestamp() AND expires_at IS NULL`,[userId]);
   if(rights.rowCount!==1) throw new NotificationAccessDenied();
   const row=(await client.query("SELECT settings,revision FROM resolute.notification_settings WHERE clerk_user_id=$1 FOR UPDATE",[userId])).rows[0];
   const current=parseNotificationSnapshot(row?{settings:row.settings,revision:Number(row.revision)}:{settings:defaultNotificationSettings(),revision:0});
   if(method==="GET") { await client.query("COMMIT");if(protect) await protect(client,userId);return current; }
   if(!parsed) throw new Error("Missing mutation");
   if(parsed.baseRevision!==current.revision) throw new NotificationConflict(current);
   if(current.revision>=Number.MAX_SAFE_INTEGER-1) throw new Error("Revision exhausted");
   const saved={settings:parsed.settings,revision:current.revision+1};
   await client.query(`INSERT INTO resolute.notification_settings(clerk_user_id,settings,revision,updated_at)
    VALUES($1,$2,$3,statement_timestamp()) ON CONFLICT(clerk_user_id) DO UPDATE
    SET settings=$2,revision=$3,updated_at=statement_timestamp()`,[userId,JSON.stringify(saved.settings),saved.revision]);
   await client.query("COMMIT");
   if(protect) await protect(client,userId);
   return saved;
  } catch(e) {try{await client.query("ROLLBACK");}catch{}
   if(e instanceof NotificationConflict && protect) await protect(client,userId);
   throw e;} finally{client.release();}
 };
}
let store:ReturnType<typeof createNotificationStore>|undefined;
export async function operateNotificationSettings(userId:string,method:"GET"|"PUT",mutation?:{settings:NotificationSettings;baseRevision:number},ownerAccess?:OwnerAccess) {
 if(process.env.RESOLUTE_NOTIFICATION_API_ENABLED!=="true") throw new Error("Notification API not enabled");
 if(!store) {
  const config=resoluteDatabaseConfig(process.env.RESOLUTE_NOTIFICATION_DB_URL);
  if(new URL(config.connectionString).username!=="resolute_notification_writer") throw new Error("Scoped writer required");
  const pool=new Pool(config);pool.on("error",()=>{});store=createNotificationStore(pool,entitlementSource(),protectionRuntime());
 }
 return store(userId,method,mutation,ownerAccess);
}
