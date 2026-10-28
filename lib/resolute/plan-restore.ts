import type { Pool } from "pg";
import { exactKeys, validRevision } from "./plan-data.ts";
export type PlanDeletion = { userId: string; revision: number; deletedAt: string };
/** Call only with the complete, decrypted, verified independent ledger, never the snapshot's journal alone. */
export async function applyPlanDeletionLedger(pool: Pick<Pool, "connect">, ledger: unknown) {
  if (!Array.isArray(ledger)) throw new Error("Invalid deletion ledger");
  const latest = new Map<string, PlanDeletion>();
  for (const entry of ledger) {
    if (!exactKeys(entry, ["userId", "revision", "deletedAt"]) || typeof entry.userId !== "string" ||
      !/^user_[A-Za-z0-9]{1,128}$/.test(entry.userId) || !validRevision(entry.revision) || entry.revision === 0 ||
      typeof entry.deletedAt !== "string" || !Number.isFinite(Date.parse(entry.deletedAt)) ||
      new Date(entry.deletedAt).toISOString() !== entry.deletedAt) throw new Error("Invalid deletion ledger");
    const marker = entry as PlanDeletion;
    if ((latest.get(marker.userId)?.revision ?? 0) < marker.revision) latest.set(marker.userId, marker);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ name: string }>("SELECT current_database() AS name");
    if (result.rows[0]?.name !== "resolute_restore_test") throw new Error("Isolated restore database required");
    for (const marker of latest.values()) {
      await client.query(`INSERT INTO resolute.plans(clerk_user_id,revision,plan,created_at,updated_at,deleted_at)
        VALUES($1,$2,NULL,NULL,NULL,$3) ON CONFLICT(clerk_user_id) DO UPDATE SET revision=$2,
        plan=NULL,created_at=NULL,updated_at=NULL,deleted_at=$3 WHERE resolute.plans.revision <= $2`,
      [marker.userId, marker.revision, marker.deletedAt]);
    }
    await client.query("COMMIT");
    return { usersChecked: latest.size };
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
  finally { client.release(); }
}
