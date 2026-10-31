import {hasOwnerAccess,ownerAccessSnapshot,type OwnerAccess} from './owner-access.ts';
import { Pool } from "pg";
import { resoluteDatabaseConfig } from "./database-config.ts";
import { entitlementSource, LEGACY_ENTITLEMENTS_QUERY, readEntitlementSnapshot } from "./entitlement-source.ts";

let pool: Pool | undefined;
function database() {
  if (!pool) {
    pool = new Pool(resoluteDatabaseConfig(process.env.ENTITLEMENT_DB_URL));
    // pg emits idle connection errors asynchronously; never log connection details.
    pool.on("error", () => {});
  }
  return pool;
}

export const RESOLUTE_ENTITLEMENTS_QUERY = LEGACY_ENTITLEMENTS_QUERY;

/** Caller must authenticate first. Shared source with plan/settings/outbox gates. */
export async function getResoluteEntitlementsForUser(userId: string, ownerAccess?:OwnerAccess) {
  if (!/^user_[A-Za-z0-9]{1,128}$/.test(userId)) throw new Error("Invalid RESOLUTE identity");
  if(hasOwnerAccess(ownerAccess,userId))return ownerAccessSnapshot(ownerAccess,userId);
  return (await readEntitlementSnapshot(database(),userId,entitlementSource())).view;
}
