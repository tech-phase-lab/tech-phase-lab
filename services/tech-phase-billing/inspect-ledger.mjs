import { billingStore } from './store.mjs';

// Explicit read-only inspection dependency. No environment credentials, network
// client, CLI entry point, repair operation, or provider call is created here.
export async function inspectSandboxLedger(pool, members, now = Date.now()) {
  if (!Array.isArray(members) || members.length !== 2 || new Set(members).size !== 2 ||
      members.some(id => typeof id !== 'string' || !/^user_[A-Za-z0-9]{1,120}$/.test(id)) ||
      !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) {
    throw Error('INVALID_INSPECTION');
  }
  const cohort = [...members];
  let client;
  let discardConnection = false;
  let result, failed = false;
  try { client = await pool.connect(); }
  catch { throw Error('LEDGER_INSPECTION_UNAVAILABLE'); }
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    const store = billingStore(client);
    const results = [];
    for (let index = 0; index < cohort.length; index++) {
      const userId = cohort[index];
      const summary = await store.summary(userId, now);
      const {rows} = await client.query(`SELECT s.currency,s.state,
        (SELECT count(*)::int FROM tech_phase_billing_sandbox.payments p WHERE p.subscription_id=s.id) AS payment_count,
        (SELECT count(*)::int FROM tech_phase_billing_sandbox.periods g
          JOIN tech_phase_billing_sandbox.payments p USING(transaction_id) WHERE p.subscription_id=s.id) AS period_count,
        (SELECT count(*)::int FROM tech_phase_billing_sandbox.payments p
          WHERE p.subscription_id=s.id AND (p.currency<>s.currency OR p.minor<>s.minor)) AS mismatched_payments,
        ARRAY(SELECT reason FROM tech_phase_billing_sandbox.review_holds WHERE subscription_id=s.id) AS hold_reasons,
        ARRAY(SELECT DISTINCT a.reason FROM tech_phase_billing_sandbox.adverse_transactions a
          JOIN tech_phase_billing_sandbox.payments p USING(transaction_id)
          WHERE p.subscription_id=s.id ORDER BY a.reason) AS adverse_reasons
        FROM tech_phase_billing_sandbox.subscriptions s WHERE s.user_id=$1
        ORDER BY s.created_at,s.id LIMIT 101`, [userId]);
      if (rows.length > 100) throw Error('INSPECTION_LIMIT');
      // Copy known columns only: no user, subscription, payer or transaction IDs.
      results.push({memberSlot: index + 1, plan: summary.plan, proExpiresAt: summary.proExpiresAt,
        reviewRequired: summary.reviewRequired,
        selectedSubscription: summary.subscription ? {currency: summary.subscription.currency, state: summary.subscription.state} : null,
        contracts: rows.map(row => ({currency: row.currency, state: row.state,
          paymentCount: row.payment_count, periodCount: row.period_count, mismatchedPayments: row.mismatched_payments,
          holdReasons: row.hold_reasons, adverseReasons: row.adverse_reasons}))});
    }
    await client.query('ROLLBACK');
    result = {environment: 'sandbox', observedAt: new Date(now).toISOString(), members: results,
      providerCompared: false};
  } catch {
    failed = true;
    try { await client.query('ROLLBACK'); }
    catch { discardConnection = true; }
  } finally {
    // A connection with uncertain transaction state must not return to the pool.
    try { client.release(discardConnection ? Error('LEDGER_INSPECTION_UNAVAILABLE') : undefined); }
    catch { failed = true; }
  }
  if (failed) throw Error('LEDGER_INSPECTION_UNAVAILABLE');
  return result;
}
