export function webhookService({ store, paypal, reconciliation, ownerId }) {
  return async (headers,event) => {
    if (!event || typeof event !== 'object' || !/^[A-Za-z0-9-]{1,128}$/.test(event.id ?? '') ||
        typeof event.event_type !== 'string') throw Error('INVALID_EVENT');
    if (!await paypal.verify(headers,event)) throw Error('INVALID_SIGNATURE');
    const type = event.event_type;
    if (type === 'PAYMENT.SALE.COMPLETED' || type.startsWith('BILLING.SUBSCRIPTION.')) {
      const providerId = type === 'PAYMENT.SALE.COMPLETED' ? event.resource?.billing_agreement_id : event.resource?.id;
      if (!/^I-[A-Z0-9]{8,32}$/.test(providerId ?? '')) throw Error('INVALID_EVENT');
      const local = await store.findSubscription(providerId);
      if (!local || local.user_id !== ownerId) return { status:'ignored' };
      // Signed notifications trigger a fresh query; event dates/status are never
      // applied directly, so delayed lifecycle messages cannot roll state back.
      return reconciliation.reconcile(local.user_id,local.id);
    }
    if (['PAYMENT.SALE.REFUNDED','PAYMENT.SALE.REVERSED'].includes(type)) {
      // Refund resources use sale_id; reversal sale resources use their sale id.
      const transactionId = type === 'PAYMENT.SALE.REFUNDED' ? event.resource?.sale_id : event.resource?.id;
      if (!/^[A-Za-z0-9-]{3,50}$/.test(transactionId ?? '')) throw Error('INVALID_EVENT');
      const reason = type.endsWith('REFUNDED') ? 'REFUNDED' : 'REVERSED';
      await store.holdTransaction(transactionId,reason);
      const local = await store.findPayment(transactionId);
      if (!local || local.user_id !== ownerId) return { status:'ignored' };
      await store.hold(local.user_id,local.id,type.endsWith('REFUNDED') ? 'REFUNDED' : 'REVERSED');
      return { status:'review-required' };
    }
    return { status:'ignored' };
  };
}
