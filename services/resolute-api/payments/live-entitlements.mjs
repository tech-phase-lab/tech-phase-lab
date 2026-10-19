import { sandboxAccess } from './access.mjs';
import { resolveResoluteEntitlements } from '../../../lib/resolute/entitlements.ts';

// Prepared adapter only. Runtime remains explicitly Sandbox-only until launch gates pass.
export const LIVE_ENTITLEMENTS_QUERY = `SELECT statement_timestamp() AS as_of,
  g.kind,g.state,g.starts_at,g.expires_at,o.state AS order_state
  FROM (SELECT $1::text AS user_id) subject
  LEFT JOIN resolute_payments_live.grants g ON g.user_id=subject.user_id
  LEFT JOIN resolute_payments_live.orders o ON o.id=g.order_id AND o.user_id=subject.user_id
    AND o.quote->>'product'='resolute_v1' AND o.quote->>'kind'=g.kind
    AND o.capture_id IS NOT NULL AND o.paid_at IS NOT NULL`;

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
  return async userId => {
    if (!/^user_[A-Za-z0-9]{1,128}$/.test(userId)) throw Error('Invalid RESOLUTE identity');
    const {rows} = await pool.query(LIVE_ENTITLEMENTS_QUERY,[userId]);
    if (!rows.length) throw Error('Missing RESOLUTE snapshot');
    const asOf = new Date(rows[0].as_of).toISOString();
    if (rows.some(r=>new Date(r.as_of).toISOString()!==asOf)) throw Error('Inconsistent RESOLUTE snapshot');
    return liveEntitlements(rows.filter(r=>r.kind!==null),asOf);
  };
}
