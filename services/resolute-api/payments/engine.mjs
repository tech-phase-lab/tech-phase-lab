import { createHash } from 'node:crypto';
import { paypalEnvironment } from './paypal-environments.mjs';
import { identity, input, quote, sameQuote, verifyOrder, reject, minorUnits, PaymentError } from './policy.mjs';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function paymentEngine({ store, paypal, merchantId, getUser, now = Date.now, environment = 'sandbox', canCharge = () => true }) {
  const selected=paypalEnvironment(environment), sandbox=environment === 'sandbox';
  const requireSales=()=>{ if (!canCharge()) reject('PAYMENT_DISABLED',503); };
  async function member(userId) { const m = identity(await getUser(userId), now()); if(m.userId !== userId) reject('AUTH_REQUIRED',401); return m; }
  async function owned(userId,id) {
    if(!uuid(id)) reject('INVALID_PAYMENT_INPUT',400);
    const order = await store.get(id); if(!order || order.user_id !== userId) reject('ORDER_NOT_FOUND',404); return order;
  }
  async function settle(order, remote) {
    try { return await store.paid(order,verifyOrder(order,remote,merchantId,true)); }
    catch(e) { if(e instanceof PaymentError) await store.flag(order,e.code); throw e; }
  }
  return {
    async create(userId,body) {
      requireSales();
      input(body,['kind','language','requestKey']); if(!uuid(body.requestKey)) reject('INVALID_PAYMENT_INPUT',400);
      const m=await member(userId), time=now();
      let order=await store.create(userId,body.requestKey,rights=>quote(body.kind,body.language,m,rights,time),time);
      if(order.quote.kind !== body.kind || order.quote.language !== body.language) reject('IDEMPOTENCY_CONFLICT');
      if(Date.parse(order.expires_at) <= now()) reject('ORDER_EXPIRED');
      if(order.state === 'creating') {
        requireSales();
        const remote=await paypal.create(order);
        if(!/^[A-Z0-9]{8,32}$/.test(remote.id ?? '')) reject('PAYPAL_UNAVAILABLE',503);
        order=await store.bind(order,remote.id);
      }
      return { orderId:order.id,paypalOrderId:order.paypal_id,state:order.state,quote:order.quote,expiresAt:order.expires_at,
        approvalUrl:order.state === 'created' ? await paypal.approval(order.paypal_id) : null,sandbox };
    },
    async capture(userId,body) {
      requireSales();
      input(body,['orderId']); let order=await owned(userId,body.orderId);
      if(order.state === 'paid') return { state:'already-paid',sandbox };
      const remote=await paypal.get(order.paypal_id);
      // A lost capture response is reconciled by reading PayPal, never by inventing a new capture.
      if(order.state === 'capturing') {
        if(remote.status !== 'COMPLETED') return { state:'pending',sandbox };
        return { state:await settle(order,remote),sandbox };
      }
      verifyOrder(order,remote,merchantId);
      const m=await member(userId);
      order=await store.prepare(order,m,now(),(current,rights)=>{
        if(!sameQuote(current.quote,quote(current.quote.kind,current.quote.language,m,rights,now()))) reject('PRICE_CHANGED');
      });
      // Fresh authoritative identity lookup immediately before the irreversible API operation.
      const finalMember=await member(userId), time=now();
      if(time >= Date.parse(order.expires_at) || !sameQuote(order.quote,quote(order.quote.kind,order.quote.language,finalMember,
        { use:order.quote.kind === 'renewal' },time))) {
        await store.flag(order,'CAPTURE_ELIGIBILITY_CHANGED'); reject('PRICE_CHANGED');
      }
      order=await store.refreshCapture(order,finalMember,now());
      requireSales();
      await paypal.capture(order);
      return { state:await settle(order,await paypal.get(order.paypal_id)),sandbox };
    },
    async status(userId,id) {
      const order=await owned(userId,id);
      if(order.state === 'capturing') {
        const remote=await paypal.get(order.paypal_id);
        if(remote.status === 'COMPLETED') await settle(order,remote);
      }
      const current=await owned(userId,id);
      return { orderId:current.id,state:current.state,quote:current.quote,expiresAt:current.expires_at,sandbox };
    },
    async webhook(headers,event) {
      if(!await paypal.verify(headers,event)) { await store.flag(null,'INVALID_WEBHOOK_SIGNATURE'); reject('INVALID_SIGNATURE',400); }
      if(typeof event.id !== 'string' || event.id.length > 160 || typeof event.event_type !== 'string') reject('INVALID_EVENT',400);
      const digest=createHash('sha256').update(JSON.stringify(event)).digest('hex');
      if(await store.eventSeen(event.id,digest)) return { received:true };
      const type=event.event_type, resource=event.resource ?? {};
      if(type === 'PAYMENT.CAPTURE.COMPLETED') {
        const details=await paypal.captureDetails(resource.id);
        const orderId=details.supplementary_data?.related_ids?.order_id;
        const order=await store.findPaypal(orderId);
        if(!order) { await store.flag(null,'UNKNOWN_COMPLETED_PAYMENT'); reject('UNKNOWN_PAYMENT',503); }
        const remote=await paypal.get(order.paypal_id);
        // Refunds can arrive before delayed COMPLETED events. Never restore them.
        if(!['revoked','suspended','held'].includes(order.state)) {
          const payment=verifyOrder(order,remote,merchantId,true);
          if(payment.captureId !== resource.id || details.id !== resource.id) reject('PAYMENT_MISMATCH');
          await settle(order,remote);
        }
      } else if(['PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED'].includes(type) || type.startsWith('CUSTOMER.DISPUTE.')) {
        let captureId;
        if(type.startsWith('CUSTOMER.DISPUTE.')) {
          const ids=(resource.disputed_transactions ?? []).map(t=>t.seller_transaction_id).filter(Boolean);
          if(!ids.length) reject('INVALID_EVENT',400);
          for(const id of ids) {
            const order=await store.findCapture(id);
            if(!order) reject('UNKNOWN_PAYMENT',503);
            await store.adverse(order.paypal_id,'suspended',type,event.id);
          }
        } else {
          captureId=type === 'PAYMENT.CAPTURE.REVERSED' ? resource.id : resource.supplementary_data?.related_ids?.capture_id;
          if(!captureId) for(const link of resource.links ?? []) {
            try { const u=new URL(link.href); const m=u.pathname.match(/^\/v2\/payments\/captures\/([A-Z0-9]{8,32})$/);
              if(link.rel === 'up' && u.protocol === 'https:' && selected.apiHosts.includes(u.hostname) && !u.port && !u.username && !u.password && !u.search && !u.hash && m) captureId=m[1];
            } catch { /* Invalid links cannot select an API target. */ }
          }
          if (!/^[A-Z0-9]{8,32}$/.test(captureId ?? '')) reject('INVALID_EVENT',400);
          const details=await paypal.captureDetails(captureId);
          const order=await store.findPaypal(details.supplementary_data?.related_ids?.order_id);
          if(!order || details.id !== captureId) reject('UNKNOWN_PAYMENT',503);
          if(details.amount?.currency_code !== order.quote.currency || minorUnits(details.amount?.value,order.quote.currency) !== order.quote.minor) reject('PAYMENT_MISMATCH');
          const full=type === 'PAYMENT.CAPTURE.REVERSED' || details.status === 'REFUNDED';
          await store.adverse(order.paypal_id,full?'revoked':'suspended',type,event.id);
        }
      }
      await store.eventDone(event.id,digest); return { received:true };
    },
  };
}
