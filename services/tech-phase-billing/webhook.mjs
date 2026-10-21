export function webhookService({ store, paypal, reconciliation, ownerId, allowedUser = userId => userId === ownerId }) {
  return async (headers,event) => {
    if (!event || typeof event !== 'object' || !/^[A-Za-z0-9-]{1,128}$/.test(event.id ?? '') ||
        typeof event.event_type !== 'string') throw Error('INVALID_EVENT');
    if (!await paypal.verify(headers,event)) throw Error('INVALID_SIGNATURE');
    const type = event.event_type;
    if (['CUSTOMER.DISPUTE.CREATED','CUSTOMER.DISPUTE.UPDATED','CUSTOMER.DISPUTE.RESOLVED'].includes(type)) {
      const transactions = event.resource?.disputed_transactions;
      if (typeof event.resource?.dispute_id !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(event.resource.dispute_id) ||
          !Array.isArray(transactions) || transactions.length < 1 || transactions.length > 100 ||
          transactions.some(t => typeof t?.seller_transaction_id !== 'string' || !/^[A-Za-z0-9-]{3,50}$/.test(t.seller_transaction_id))) throw Error('INVALID_EVENT');
      // A signed dispute may precede our payment row. Save every seller-side
      // transaction first; buyer transaction IDs never identify our ledger.
      // Resolution is manual review, never an automatic restoration of access.
      let matched = false;
      for (const transactionId of new Set(transactions.map(t => t.seller_transaction_id))) {
        const local = await store.findPayment(transactionId);
        if (local && !allowedUser(local.user_id)) continue;
        await store.holdTransaction(transactionId,'DISPUTED');
        if (!local || !allowedUser(local.user_id)) continue;
        await store.hold(local.user_id,local.id,'DISPUTED');
        matched = true;
      }
      return {status:matched ? 'review-required' : 'ignored'};
    }
    if (type === 'PAYMENT.SALE.COMPLETED' || type.startsWith('BILLING.SUBSCRIPTION.')) {
      const providerId = type === 'PAYMENT.SALE.COMPLETED' ? event.resource?.billing_agreement_id : event.resource?.id;
      if (!/^I-[A-Z0-9]{8,32}$/.test(providerId ?? '')) throw Error('INVALID_EVENT');
      const local = await store.findSubscription(providerId);
      if (!local || !allowedUser(local.user_id)) return { status:'ignored' };
      // Signed notifications trigger a fresh query; event dates/status are never
      // applied directly, so delayed lifecycle messages cannot roll state back.
      return reconciliation.reconcile(local.user_id,local.id);
    }
    if (['PAYMENT.SALE.REFUNDED','PAYMENT.SALE.REVERSED'].includes(type)) {
      // Refund resources use sale_id; reversal sale resources use their sale id.
      const transactionId = type === 'PAYMENT.SALE.REFUNDED' ? event.resource?.sale_id : event.resource?.id;
      if (!/^[A-Za-z0-9-]{3,50}$/.test(transactionId ?? '')) throw Error('INVALID_EVENT');
      const reason = type.endsWith('REFUNDED') ? 'REFUNDED' : 'REVERSED';
      const local = await store.findPayment(transactionId);
      if (local && !allowedUser(local.user_id)) return {status:'ignored'};
      await store.holdTransaction(transactionId,reason);
      if (!local || !allowedUser(local.user_id)) return { status:'ignored' };
      await store.hold(local.user_id,local.id,type.endsWith('REFUNDED') ? 'REFUNDED' : 'REVERSED');
      return { status:'review-required' };
    }
    return { status:'ignored' };
  };
}
