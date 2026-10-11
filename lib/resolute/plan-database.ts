import { Pool, type PoolClient } from "pg";
import { resoluteDatabaseConfig } from "./database-config.ts";
import { parsePlanSnapshot, type PlanInput, type PlanSnapshot } from "./plan-data.ts";

type Row = { plan: PlanInput | null; revision: string; created_at: Date | null; updated_at: Date | null };
export class PlanAccessDenied extends Error {}
export class PlanConflict extends Error {
  readonly snapshot: PlanSnapshot;
  constructor(snapshot: PlanSnapshot) { super("REVISION_CONFLICT"); this.snapshot = snapshot; }
}
function snapshot(row: Row | undefined): PlanSnapshot {
  if (!row) return { plan: null, revision: 0 };
  return parsePlanSnapshot({ plan: row.plan === null ? null : { ...row.plan,
    createdAt: row.created_at?.toISOString(), updatedAt: row.updated_at?.toISOString() }, revision: Number(row.revision) });
}
export function createPlanStore(pool: Pick<Pool, "connect">) {
  return async (userId: string, method: "GET" | "PUT" | "DELETE", mutation?: { baseRevision: number; plan: PlanInput | null }) => {
    if (!/^user_[A-Za-z0-9]{1,128}$/.test(userId)) throw new Error("Invalid identity");
    const client: PoolClient = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serializes initial creation, updates and deletions, including absent rows.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [userId]);
      const rights = await client.query(`SELECT 1 FROM resolute.entitlements WHERE clerk_user_id=$1
        AND product_id='resolute_v1' AND kind='use' AND revoked_at IS NULL
        AND starts_at<=statement_timestamp() AND expires_at IS NULL FOR SHARE`, [userId]);
      const active = rights.rowCount === 1;
      if (method !== "DELETE" && !active) throw new PlanAccessDenied();
      const result = await client.query<Row>("SELECT plan,revision,created_at,updated_at FROM resolute.plans WHERE clerk_user_id=$1 FOR UPDATE", [userId]);
      const current = snapshot(result.rows[0]);
      if (method === "GET") { await client.query("COMMIT"); return current; }
      if (!mutation) throw new Error("Missing mutation");
      if (current.revision !== mutation.baseRevision)
        throw new PlanConflict(active ? current : { plan: null, revision: current.revision });
      if (current.revision >= Number.MAX_SAFE_INTEGER - 1) throw new Error("Revision exhausted");
      const revision = current.revision + 1;
      if (method === "DELETE") {
        await client.query(`INSERT INTO resolute.plans(clerk_user_id,revision,plan,created_at,updated_at,deleted_at)
          VALUES($1,$2,NULL,NULL,NULL,statement_timestamp()) ON CONFLICT(clerk_user_id) DO UPDATE
          SET revision=$2,plan=NULL,created_at=NULL,updated_at=NULL,deleted_at=statement_timestamp()`, [userId, revision]);
        await client.query(`INSERT INTO resolute.plan_deletions(clerk_user_id,revision,deleted_at)
          SELECT clerk_user_id,revision,deleted_at FROM resolute.plans WHERE clerk_user_id=$1`, [userId]);
      } else {
        if (!mutation.plan) throw new Error("Missing plan");
        await client.query(`INSERT INTO resolute.plans(clerk_user_id,revision,plan,created_at,updated_at)
          VALUES($1,$2,$3,statement_timestamp(),statement_timestamp()) ON CONFLICT(clerk_user_id) DO UPDATE
          SET revision=$2,plan=$3,created_at=COALESCE(resolute.plans.created_at,statement_timestamp()),
          updated_at=statement_timestamp(),deleted_at=NULL`, [userId, revision, JSON.stringify(mutation.plan)]);
      }
      const saved = await client.query<Row>("SELECT plan,revision,created_at,updated_at FROM resolute.plans WHERE clerk_user_id=$1", [userId]);
      const value = snapshot(saved.rows[0]);
      await client.query("COMMIT"); return value;
    } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
    finally { client.release(); }
  };
}
let store: ReturnType<typeof createPlanStore> | undefined;
export async function operateResolutePlan(userId: string, method: "GET" | "PUT" | "DELETE", mutation?: { baseRevision: number; plan: PlanInput | null }) {
  // Remains unavailable until schema, scoped writer and independent deletion ledger are verified.
  if (process.env.RESOLUTE_PLAN_API_ENABLED !== "true") throw new Error("Plan API not enabled");
  if (!store) {
    const config = resoluteDatabaseConfig(process.env.RESOLUTE_PLAN_DB_URL);
    if (new URL(config.connectionString).username !== "resolute_plan_writer") throw new Error("Scoped writer required");
    const pool = new Pool(config); pool.on("error", () => {}); store = createPlanStore(pool);
  }
  return store(userId, method, mutation);
}
