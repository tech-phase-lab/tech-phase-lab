import {hasOwnerAccess,type OwnerAccess} from './owner-access.ts';
import { protectionRuntime } from "./protection-runtime.ts";
import type { ProtectionBarrier } from "./protection-outbox.ts";
import { entitlementSource, readEntitlementSnapshot, type EntitlementSource } from "./entitlement-source.ts";
import { Pool, type PoolClient } from "pg";
import { resoluteDatabaseConfig } from "./database-config.ts";
import { createSettingsSplitAdjuster, keepStoredOriginals, stampPriceDays, type SettingsSplitAdjuster } from "./notification-splits.ts";
import { createSplitLoader, etDay } from "../research/stock-splits.ts";
import { leaseFromEnv } from "./twelve-lease.ts";
import { createCachedSplitLoader } from "./twelve-cache.ts";
import { defaultNotificationSettings, parseNotificationMutation, parseNotificationSnapshot,
 type NotificationSnapshot, type NotificationSettings } from "./notification-settings.ts";
export class NotificationAccessDenied extends Error {}
export class NotificationConflict extends Error {
 readonly snapshot: NotificationSnapshot;
 constructor(snapshot: NotificationSnapshot) { super("REVISION_CONFLICT"); this.snapshot=snapshot; }
}
/** `adjust` (stock splits): GET and a conflict answer show the reference prices on today's basis (see notification-splits.ts), so what the
 * member sees and saves back is post-split; the saved row then carries the new date and is not adjusted again. */
export function createNotificationStore(pool: Pick<Pool,"connect">, source: EntitlementSource = entitlementSource(), protect?: ProtectionBarrier, adjust?: SettingsSplitAdjuster, clock: () => Date = () => new Date()) {
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
   const row=(await client.query("SELECT settings,revision,updated_at FROM resolute.notification_settings WHERE clerk_user_id=$1 FOR UPDATE",[userId])).rows[0];
   const current=parseNotificationSnapshot(row?{settings:row.settings,revision:Number(row.revision)}:{settings:defaultNotificationSettings(),revision:0});
   const shown=async():Promise<NotificationSnapshot>=>adjust&&row?{...current,settings:(await adjust(current.settings,row.updated_at??null).catch(()=>({settings:current.settings}))).settings}:current;
   if(method==="GET") { await client.query("COMMIT");if(protect) await protect(client,userId);return shown(); }
   if(!parsed) throw new Error("Missing mutation");
   if(parsed.baseRevision!==current.revision) throw new NotificationConflict(await shown());
   if(current.revision>=Number.MAX_SAFE_INTEGER-1) throw new Error("Revision exhausted");
   // Each reference price keeps the day it is on (sent back by the screen, or the stored one when an old screen sends the stored price
   // unchanged); only a new or changed price without a day is today's (notification-splits.ts).
   // An item sent back exactly as GET showed it keeps the stored original price and day (no rewrite by a split, same rule key).
   const today=etDay(clock()),stored=row?{settings:current.settings,savedAt:row.updated_at??null}:undefined;
   const sent=stored&&adjust?keepStoredOriginals(parsed.settings,stored,(await shown()).settings):parsed.settings;
   const saved={settings:stampPriceDays(sent,today,today,stored),revision:current.revision+1};
   await client.query(`INSERT INTO resolute.notification_settings(clerk_user_id,settings,revision,updated_at)
    VALUES($1,$2,$3,statement_timestamp()) ON CONFLICT(clerk_user_id) DO UPDATE
    SET settings=$2,revision=$3,updated_at=statement_timestamp()`,[userId,JSON.stringify(saved.settings),saved.revision]);
   await client.query("COMMIT");
   if(protect) await protect(client,userId);
   // The answer is what GET would show (today's basis), so the screen sees the numbers it sent.
   return adjust?{...saved,settings:(await adjust(saved.settings,clock()).catch(()=>({settings:saved.settings}))).settings}:saved;
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
  const pool=new Pool(config);pool.on("error",()=>{});
  store=createNotificationStore(pool,entitlementSource(),protectionRuntime(),createSettingsSplitAdjuster(createCachedSplitLoader(pool,
   createSplitLoader({apiKey:process.env.TWELVE_DATA_API_KEY,lease:leaseFromEnv(process.env,{tier:"critical",perMinute:60}),leaseWaitMs:3000}))));
  // Splits: the shared copy first (refreshed once a day by the notifications cron's prefetch); a symbol it lacks (or no table yet) is read
  // from the provider (kept a day per process, leased, waiting at most 3 seconds); without a key, the manual list as before.
 }
 return store(userId,method,mutation,ownerAccess);
}
