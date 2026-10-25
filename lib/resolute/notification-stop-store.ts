import type { Pool } from "pg";
import type { ProtectionBarrier } from "./protection-outbox.ts";
import { parseNotificationSnapshot } from "./notification-settings.ts";

/** Stop-only capability: no purchase requirement, no row/account recreation,
 * no caller-controlled settings, and no re-enable path. Existing stop triggers
 * journal both channels. Commit the stop before publishing its protection event;
 * if publishing fails, sending is already disabled and retry can finish custody.
 */
export function createMailStopStore(pool:Pick<Pool,"connect">,protect:ProtectionBarrier) {
 return async(userId:string)=>{
  if(!/^user_[A-Za-z0-9]{1,128}$/.test(userId))throw new Error("Invalid stop identity");
  const client=await pool.connect();
  try{
   await client.query("BEGIN");
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",[userId]);
   const row=(await client.query("SELECT settings,revision FROM resolute.notification_settings WHERE clerk_user_id=$1 FOR UPDATE",[userId])).rows[0];
   if(row){
    const current=parseNotificationSnapshot({settings:row.settings,revision:Number(row.revision)});
    if(current.settings.alertsEnabled||current.settings.morningEnabled){
     if(current.revision>=Number.MAX_SAFE_INTEGER-1)throw new Error("Revision exhausted");
     await client.query(`UPDATE resolute.notification_settings SET settings=$2,revision=$3,updated_at=statement_timestamp()
      WHERE clerk_user_id=$1`,[userId,JSON.stringify({...current.settings,alertsEnabled:false,morningEnabled:false}),current.revision+1]);
    }
   }
   await client.query("COMMIT");
  }catch(e){try{await client.query("ROLLBACK");}catch{}throw e;}
  finally{client.release();}
  // A separate connection avoids holding the setting lock during external I/O.
  const journal=await pool.connect();try{await protect(journal,userId);}finally{journal.release();}
  return {stopped:true as const};
 };
}
