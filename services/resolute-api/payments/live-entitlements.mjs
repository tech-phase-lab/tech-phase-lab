import { sandboxAccess } from './access.mjs';
import { resolveResoluteEntitlements } from '../../../lib/resolute/entitlements.ts';

import { readEntitlementSnapshot } from '../../../lib/resolute/entitlement-source.ts';
export { LIVE_ENTITLEMENTS_QUERY } from '../../../lib/resolute/entitlement-source.ts';

export function liveEntitlements(rows, asOf) {
  // Reuse the verified interval calculation, never its Sandbox response envelope.
  const access = sandboxAccess(rows, asOf);
  const now = Date.parse(asOf), records = [];
  if (access.useStartsAt !== null) records.push({kind:'use',startsAt:access.useStartsAt,expiresAt:null,revokedAt:null});
  // Choose the actual current interval. Do not bridge a refunded year to a later purchase.
  const period = access.alertPeriods.find(p=>Date.parse(p.startsAt)<=now && now<Date.parse(p.expiresAt))
    ?? access.alertPeriods.find(p=>Date.parse(p.startsAt)>now)
    ?? access.alertPeriods.at(-1);
  if (period && access.useStartsAt !== null) records.push({kind:'alerts',...period,revokedAt:null});
  return resolveResoluteEntitlements(records, access.asOf);
}

export function createLiveEntitlementReader(pool) {
  return async userId => (await readEntitlementSnapshot(pool,userId,'live')).view;
}
