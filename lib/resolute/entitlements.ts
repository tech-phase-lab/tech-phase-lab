export const RESOLUTE_PRODUCT_ID = "resolute_v1";
export type EntitlementKind = "use" | "alerts";
export type EntitlementStatus = "missing" | "scheduled" | "active" | "expired" | "revoked";
export type EntitlementRecord = {
  kind: EntitlementKind;
  startsAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};
export type EntitlementView = {
  status: EntitlementStatus;
  startsAt: string | null;
  expiresAt: string | null;
};

function timestamp(value: string): number {
  // Accept only the canonical UTC format returned by the DB adapter.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error("Invalid entitlement timestamp");
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z")) {
    throw new Error("Invalid entitlement timestamp");
  }
  return ms;
}

function view(record: EntitlementRecord | undefined, now: number): EntitlementView {
  if (!record) return { status: "missing", startsAt: null, expiresAt: null };
  const starts = timestamp(record.startsAt);
  const expires = record.expiresAt === null ? null : timestamp(record.expiresAt);
  if ((record.kind === "use" && expires !== null) ||
      (record.kind === "alerts" && (expires === null || expires <= starts))) {
    throw new Error("Invalid entitlement period");
  }
  if (record.revokedAt !== null) timestamp(record.revokedAt);
  const status: EntitlementStatus = record.revokedAt !== null ? "revoked"
    : now < starts ? "scheduled"
    : expires !== null && now >= expires ? "expired" : "active";
  return { status, startsAt: record.startsAt, expiresAt: record.expiresAt };
}

/** Purchase records only. Deliberately accepts no plan/admin/preview metadata. */
export function resolveResoluteEntitlements(records: EntitlementRecord[], asOf: string) {
  const now = timestamp(asOf);
  const byKind = new Map<EntitlementKind, EntitlementRecord>();
  for (const record of records) {
    if (!(record.kind === "use" || record.kind === "alerts") || byKind.has(record.kind)) {
      throw new Error("Invalid entitlement records");
    }
    byKind.set(record.kind, record);
  }
  const use = view(byKind.get("use"), now);
  const alerts = view(byKind.get("alerts"), now);
  return {
    productId: RESOLUTE_PRODUCT_ID, asOf, use, alerts,
    canUseTools: use.status === "active",
    canReceiveNotifications: use.status === "active" && alerts.status === "active",
  };
}
