/** Read model for the Sandbox ledger only. Never used by production access gates. */
export function sandboxAccess(rows, asOf) {
  const now = Date.parse(asOf);
  if (!Number.isFinite(now)) throw Error('Invalid access clock');
  const intervals = [];
  let useStartsAt = null;
  for (const row of rows) {
    if (!['initial', 'renewal'].includes(row.kind) ||
        !['active', 'suspended', 'revoked'].includes(row.state)) throw Error('Invalid access grant');
    const start = Date.parse(row.starts_at), end = Date.parse(row.expires_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw Error('Invalid access period');
    // Both records must still agree. A stale grant must not revive an adverse order.
    if (row.state !== 'active' || row.order_state !== 'paid') continue;
    if (row.kind === 'initial' && (useStartsAt === null || start < useStartsAt)) useStartsAt = start;
    intervals.push({ start, end });
  }
  intervals.sort((a, b) => a.start - b.start);
  const coverage = [];
  for (const interval of intervals) {
    const previous = coverage.at(-1);
    // Merge only continuous coverage: refunded renewals must leave a gap.
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else coverage.push({ ...interval });
  }
  const canUseTools = useStartsAt !== null && useStartsAt <= now;
  const current = coverage.find(period => period.start <= now && now < period.end);
  return {
    sandbox: true, productId: 'resolute_v1', asOf: new Date(now).toISOString(),
    canUseTools, canReceiveNotifications: canUseTools && Boolean(current),
    useStartsAt: useStartsAt === null ? null : new Date(useStartsAt).toISOString(),
    alertPeriods: coverage.map(period => ({ startsAt: new Date(period.start).toISOString(), expiresAt: new Date(period.end).toISOString() })),
  };
}
