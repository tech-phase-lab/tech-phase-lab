import { offer } from './paypal.mjs';
const reject = () => { throw Error('SETTLEMENT_REVIEW_REQUIRED'); };
export function amountMinor(money, currency) {
  if (money?.currency_code !== currency || typeof money.value !== 'string') return null;
  const pattern = currency === 'JPY' ? /^(0|[1-9]\d{0,8})(?:\.0{1,2})?$/ : /^(0|[1-9]\d{0,8})(?:\.\d{1,2})?$/;
  if (!['JPY','USD'].includes(currency) || !pattern.test(money.value)) return null;
  const [whole, fraction = ''] = money.value.split('.');
  return currency === 'JPY' ? Number(whole) : Number(whole) * 100 + Number(fraction.padEnd(2,'0'));
}
// Calculate each boundary from the original anchor, not from the previous clamped
// month: Jan 31 -> Feb 28 -> Mar 31. Reject dates outside the bounded contract.
export function monthlyBoundary(anchor, count) {
  const date = new Date(anchor);
  if (!Number.isFinite(date.getTime()) || !Number.isInteger(count) || count < 0 || count > 1200) reject();
  const day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + count);
  const last = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth() + 1,0)).getUTCDate();
  date.setUTCDate(Math.min(day,last));
  return date.toISOString();
}
export function assertSubscription(local, remote, plans) {
  if (!local?.paypal_id || remote?.id !== local.paypal_id || remote.custom_id !== local.id ||
      remote.plan_id !== plans[local.currency] || (remote.quantity !== undefined && remote.quantity !== '1') ||
      (remote.shipping_amount && amountMinor(remote.shipping_amount,local.currency) !== 0)) reject();
}
// Conservative automatic settlement: only the latest paid regular cycle with a
// matching completed transaction, no arrears, and a consistent monthly schedule.
// Dates alone, cycle counts alone, approval and ACTIVE never grant access.
export function verifiedPeriod(local, remote, transactions, plans, now = Date.now(), storedPeriod = null) {
  assertSubscription(local,remote,plans);
  const q = offer(local.currency), info = remote.billing_info, cycles = info?.cycle_executions, cycle = cycles?.[0];
  if (!['ACTIVE','CANCELLED','SUSPENDED','EXPIRED'].includes(remote.status) || local.minor !== q.minor ||
      !Array.isArray(cycles) || cycles.length !== 1 || cycle.tenure_type !== 'REGULAR' || cycle.sequence !== 1 ||
      !Number.isInteger(cycle.cycles_completed) || cycle.cycles_completed < 1 ||
      info.failed_payments_count !== 0 || amountMinor(info.outstanding_balance,q.currency) !== 0 ||
      amountMinor(info.last_payment?.amount,q.currency) !== q.minor) reject();
  const expectedStart = monthlyBoundary(remote.start_time,cycle.cycles_completed - 1);
  const expectedEnd = monthlyBoundary(remote.start_time,cycle.cycles_completed);
  // PayPal can schedule the first renewal on the following UTC date (observed
  // in Sandbox). Bound that initial offset to less than 24 hours; retain the
  // existing strict renewal rule instead of extrapolating an unverified clock.
  // Never infer extra cycles from an arbitrary next_billing_time.
  const next = Date.parse(info.next_billing_time);
  let start, end;
  if (Number.isFinite(next)) {
    end = new Date(next).toISOString();
    start = cycle.cycles_completed === 1 ? expectedStart : expectedStart.slice(0,10) + end.slice(10);
  } else {
    // Cancellation can remove next_billing_time. Retain an already verified
    // immutable period for this exact payment; do not guess a new expiry.
    if (remote.status === 'ACTIVE' || info.next_billing_time || !storedPeriod) reject();
    start = storedPeriod.periodStart; end = storedPeriod.periodEnd;
  }
  const paid = Date.parse(info.last_payment?.time);
  const endOffset = Date.parse(end) - Date.parse(expectedEnd);
  const firstRenewalOffset = cycle.cycles_completed === 1 && endOffset >= 0 && endOffset < 86400000;
  if (typeof start !== 'string' || typeof end !== 'string' ||
      !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) ||
      start.slice(0,10) !== expectedStart.slice(0,10) ||
      (end.slice(0,10) !== expectedEnd.slice(0,10) && !firstRenewalOffset) ||
      !Number.isFinite(paid) || paid < Date.parse(start) || paid >= Date.parse(end) || paid > now ||
      !Array.isArray(transactions)) reject();
  const matches = transactions.filter(t => Date.parse(t.time) === paid);
  if (matches.length !== 1) reject();
  const payment = matches[0];
  if (!/^[A-Za-z0-9-]{3,50}$/.test(payment.id ?? '') || payment.status !== 'COMPLETED' ||
      amountMinor(payment.amount_with_breakdown?.gross_amount,q.currency) !== q.minor) reject();
  return { transactionId: payment.id, currency:q.currency, minor:q.minor,
    paidAt:new Date(paid).toISOString(), periodStart:start, periodEnd:end };
}
export function reconciliationService({ store, paypal, plans, now = Date.now }) {
  return {
    async reconcile(userId, id) {
      const local = await store.get(userId,id);
      if (!local?.paypal_id) throw Error('SUBSCRIPTION_NOT_FOUND');
      const first = await paypal.get(local.paypal_id);
      assertSubscription(local,first,plans);
      await store.providerState(userId,id,first.status);
      const paid = Date.parse(first.billing_info?.last_payment?.time);
      if (!Number.isFinite(paid)) return { status:await store.hasReviewHold(userId,id) ? 'review-required' : 'payment-pending', ...(await store.entitlement(userId,now())) };
      if (paid > now()) reject();
      const result = await paypal.transactions(local.paypal_id,new Date(paid - 1000).toISOString(),new Date(paid + 1000).toISOString());
      if (!Array.isArray(result?.transactions)) reject();
      // Compare provider evidence across the transaction fetch to reject a mixed
      // renewal snapshot. Caller retries from durable state, never guessed dates.
      const latest = await paypal.get(local.paypal_id);
      assertSubscription(local,latest,plans);
      if (JSON.stringify([first.status,first.start_time,first.billing_info]) !==
          JSON.stringify([latest.status,latest.start_time,latest.billing_info])) throw Error('SETTLEMENT_RETRY');
      if (result.transactions.some(t => ['REFUNDED','PARTIALLY_REFUNDED'].includes(t.status))) {
        await store.hold(userId,id,result.transactions.find(t=>['REFUNDED','PARTIALLY_REFUNDED'].includes(t.status)).status);
        return { status:'review-required', ...(await store.entitlement(userId,now())) };
      }
      const matches = result.transactions.filter(t => Date.parse(t.time) === paid);
      const storedPeriod = !latest.billing_info?.next_billing_time && matches.length === 1
        ? await store.paidPeriod(userId,id,matches[0].id) : null;
      const payment = verifiedPeriod(local,latest,result.transactions,plans,now(),storedPeriod);
      await store.recordPayment({ eventId:`reconcile.${payment.transactionId}`,eventType:'PAYMENT.SALE.COMPLETED',id,...payment });
      // A crash between the payment and period writes remains FREE and is
      // recoverable. Each insert is immutable and keyed by the same transaction.
      await store.grantPeriod(userId,id,payment);
      return { status:await store.hasReviewHold(userId,id) ? 'review-required' : 'verified', ...(await store.entitlement(userId,now())) };
    },
  };
}
