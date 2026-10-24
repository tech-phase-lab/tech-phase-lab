import type { Pool } from "pg";
import { RESOLUTE_PRODUCT_ID, resolveResoluteEntitlements, type EntitlementRecord } from "./entitlements.ts";

export type EntitlementSource = "legacy" | "live";
export function entitlementSource(value = process.env.RESOLUTE_ENTITLEMENT_SOURCE): EntitlementSource {
  if (value === undefined || value === "legacy") return "legacy";
  if (value === "live") return "live";
  throw new Error("Invalid entitlement source");
}
export const LEGACY_ENTITLEMENTS_QUERY = `
SELECT statement_timestamp() AS as_of,
       e.kind, e.starts_at, e.expires_at, e.revoked_at
FROM (SELECT $1::text AS clerk_user_id) AS subject
LEFT JOIN resolute.entitlements AS e
  ON e.clerk_user_id = subject.clerk_user_id AND e.product_id = $2
ORDER BY e.kind`;

// One statement and database clock for all records. Never bridge a refunded interval.
export const LIVE_ENTITLEMENTS_QUERY = `WITH valid AS (
 SELECT kind,starts_at,expires_at FROM resolute_payments_live.entitlement_periods
 WHERE clerk_user_id=$1 AND product_id=$2
), initial AS (
 SELECT min(starts_at) AS starts_at FROM valid WHERE kind='initial'
), periods AS (
 SELECT unnest(range_agg(tstzrange(starts_at,expires_at,'[)'))) AS span FROM valid
), chosen AS (
 SELECT span FROM periods ORDER BY
 CASE WHEN span @> statement_timestamp() THEN 0
      WHEN lower(span)>statement_timestamp() THEN 1 ELSE 2 END,
 CASE WHEN lower(span)>statement_timestamp() THEN lower(span) END ASC,
 upper(span) DESC LIMIT 1
), entitlements AS (
 SELECT 'use'::text AS kind,starts_at,NULL::timestamptz AS expires_at FROM initial WHERE starts_at IS NOT NULL
 UNION ALL
 SELECT 'alerts',lower(span),upper(span) FROM chosen
 WHERE EXISTS(SELECT 1 FROM initial WHERE starts_at IS NOT NULL)
)
SELECT statement_timestamp() AS as_of,e.kind,e.starts_at,e.expires_at,NULL::timestamptz AS revoked_at
FROM (SELECT $1::text AS clerk_user_id) subject LEFT JOIN entitlements e ON true ORDER BY e.kind`;

type Row = {as_of: Date;kind:EntitlementRecord["kind"]|null;starts_at:Date|null;expires_at:Date|null;revoked_at:Date|null};
export async function readEntitlementSnapshot(db: Pick<Pool,"query">, userId:string, source:EntitlementSource) {
  if (!/^user_[A-Za-z0-9]{1,128}$/.test(userId)) throw new Error("Invalid RESOLUTE identity");
  if (source!=="legacy" && source!=="live") throw new Error("Invalid entitlement source");
  const {rows}=await db.query<Row>(source==="live"?LIVE_ENTITLEMENTS_QUERY:LEGACY_ENTITLEMENTS_QUERY,[userId,RESOLUTE_PRODUCT_ID]);
  if (!rows.length) throw new Error("Missing RESOLUTE snapshot");
  const asOf=rows[0].as_of.toISOString(),records:EntitlementRecord[]=[];
  for(const row of rows) {
    if(row.as_of.toISOString()!==asOf) throw new Error("Inconsistent RESOLUTE snapshot");
    if(row.kind===null) continue;
    if(!row.starts_at) throw new Error("Invalid RESOLUTE row");
    records.push({kind:row.kind,startsAt:row.starts_at.toISOString(),expiresAt:row.expires_at?.toISOString()??null,revokedAt:row.revoked_at?.toISOString()??null});
  }
  return {records,asOf,view:resolveResoluteEntitlements(records,asOf)};
}
