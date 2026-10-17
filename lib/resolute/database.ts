import { Pool } from "pg";
import { resoluteDatabaseConfig } from "./database-config.ts";
import { RESOLUTE_PRODUCT_ID, resolveResoluteEntitlements, type EntitlementRecord } from "./entitlements.ts";

let pool: Pool | undefined;
function database() {
  if (!pool) {
    pool = new Pool(resoluteDatabaseConfig(process.env.ENTITLEMENT_DB_URL));
    // pg emits idle connection errors asynchronously; never log connection details.
    pool.on("error", () => {});
  }
  return pool;
}

export const RESOLUTE_ENTITLEMENTS_QUERY = `
SELECT statement_timestamp() AS as_of,
       e.kind, e.starts_at, e.expires_at, e.revoked_at
FROM (SELECT $1::text AS clerk_user_id) AS subject
LEFT JOIN resolute.entitlements AS e
  ON e.clerk_user_id = subject.clerk_user_id AND e.product_id = $2
ORDER BY e.kind`;

/** Caller must authenticate first. Query is scoped by the verified Clerk ID. */
export async function getResoluteEntitlementsForUser(userId: string) {
  if (!/^user_[A-Za-z0-9]{1,128}$/.test(userId)) throw new Error("Invalid RESOLUTE identity");
  const result = await database().query<{
    as_of: Date; kind: EntitlementRecord["kind"] | null;
    starts_at: Date | null; expires_at: Date | null; revoked_at: Date | null;
  }>(RESOLUTE_ENTITLEMENTS_QUERY, [userId, RESOLUTE_PRODUCT_ID]);
  if (!result.rows.length) throw new Error("Missing RESOLUTE snapshot");
  const asOf = result.rows[0].as_of.toISOString();
  const records: EntitlementRecord[] = [];
  for (const row of result.rows) {
    if (row.as_of.toISOString() !== asOf) throw new Error("Inconsistent RESOLUTE snapshot");
    if (row.kind === null) continue;
    if (!row.starts_at) throw new Error("Invalid RESOLUTE row");
    records.push({ kind: row.kind, startsAt: row.starts_at.toISOString(),
      expiresAt: row.expires_at?.toISOString() ?? null,
      revokedAt: row.revoked_at?.toISOString() ?? null });
  }
  return resolveResoluteEntitlements(records, asOf);
}
