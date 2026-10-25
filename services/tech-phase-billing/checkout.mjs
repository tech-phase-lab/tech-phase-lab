import { approvalUrl } from './paypal.mjs';
// Internal authenticated-service API, not a public HTTP handler. userId must come
// from verified Clerk authentication. No return-page input can grant membership.
export function checkoutService({ store, paypal, termsVersion, now = Date.now }) {
  return {
    async start(userId, currency, acceptedTerms) {
      if (!termsVersion || acceptedTerms !== termsVersion) throw Error('TERMS_REQUIRED');
      let row = await store.reserve(userId, currency, termsVersion);
      if (!row.paypal_id) {
        // PayPal retains create keys for 72h. Never blindly retry after that window.
        const age = now() - new Date(row.created_at).getTime();
        if (!Number.isFinite(age) || age < 0 || age >= 71 * 3600000) throw Error('RECONCILIATION_REQUIRED');
        const remote = await paypal.create({ id: row.id, currency: row.currency });
        row = await store.attach(userId, row.id, remote.id);
        return { id: row.id, approvalUrl: remote.approvalUrl };
      }
      const remote = await paypal.get(row.paypal_id);
      if (remote.id !== row.paypal_id || remote.custom_id !== row.id) throw Error('SUBSCRIPTION_MISMATCH');
      return { id: row.id, status: remote.status,
        approvalUrl: remote.status === 'APPROVAL_PENDING' ? approvalUrl(remote,paypal.environment ?? 'sandbox') : null };
    },
    async cancel(userId, id) {
      const row = await store.get(userId,id);
      if (!row?.paypal_id) throw Error('SUBSCRIPTION_NOT_FOUND');
      const remote = await paypal.get(row.paypal_id);
      if (remote.id !== row.paypal_id || remote.custom_id !== row.id) throw Error('SUBSCRIPTION_MISMATCH');
      // Recover a lost cancellation response by reading PayPal before retrying.
      if (!['CANCELLED','EXPIRED'].includes(remote.status)) {
        if (!['ACTIVE','SUSPENDED'].includes(remote.status)) throw Error('SUBSCRIPTION_NOT_CANCELLABLE');
        await paypal.cancel(row.paypal_id);
      }
      await store.cancelled(userId,id);
      return { status: 'cancelled' };
    },
  };
}
