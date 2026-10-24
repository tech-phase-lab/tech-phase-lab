import { randomUUID } from 'node:crypto';
import { offer } from './paypal.mjs';
// A pg Pool-compatible dependency. No process-global pool or fallback database.
export function billingStore(pool, mode = 'sandbox') {
  if(!['sandbox','live'].includes(mode))throw Error('BILLING_DISABLED');
  const S=mode==='live'?'tech_phase_billing_live':'tech_phase_billing_sandbox';
  async function transaction(work) {
    const client = await pool.connect();
    let discard=false;
    try { await client.query('BEGIN'); const value = await work(client); await client.query('COMMIT'); return value; }
    catch(error){try{await client.query('ROLLBACK');}catch{discard=true;}throw error;}
    finally{client.release(discard?Error('BILLING_TRANSACTION_FAILED'):undefined);}
  }
  return {
    async summary(userId, now = Date.now()) {
      if (!Number.isFinite(now)) throw Error('INVALID_TIME');
      // One statement gives access, selected contract and review state the same
      // database snapshot, even if a refund arrives while this request runs.
      const row=(await pool.query(`WITH selected AS (
        SELECT id,currency,state FROM ${S}.subscriptions WHERE user_id=$1
        ORDER BY (state NOT IN ('cancelled','expired')) DESC,created_at DESC,id DESC LIMIT 1
      ), access AS (
        SELECT max(period_end) AS until FROM ${S}.entitlement_periods
        WHERE user_id=$1 AND period_start <= $2 AND period_end > $2
      ) SELECT s.id,s.currency,s.state,a.until,EXISTS (
        SELECT 1 FROM selected chosen WHERE
          EXISTS (SELECT 1 FROM ${S}.review_holds h WHERE h.subscription_id=chosen.id) OR
          EXISTS (SELECT 1 FROM ${S}.payments p JOIN ${S}.adverse_transactions adverse USING(transaction_id)
            WHERE p.subscription_id=chosen.id)
      ) AS review_required FROM access a LEFT JOIN selected s ON true`,[userId,new Date(now)])).rows[0];
      const until=row.until ? new Date(row.until).toISOString() : null;
      return {environment:mode,plan:until ? 'pro' : 'free',proExpiresAt:until,
        subscription:row.id ? {id:row.id,currency:row.currency,state:row.state} : null,
        reviewRequired:row.review_required === true};
    },
    async reserve(userId, currency, termsVersion) {
      const q = offer(currency);
      if (typeof userId !== 'string' || !userId || userId.length > 128 ||
          typeof termsVersion !== 'string' || !termsVersion || termsVersion.length > 128) throw Error('INVALID_CHECKOUT');
      return transaction(async db => {
        // The partial unique index also protects different keys and concurrent requests.
        await db.query(`INSERT INTO ${S}.subscriptions(id,user_id,currency,minor,terms_version)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id) WHERE state NOT IN ('cancelled','expired') DO NOTHING`,
          [randomUUID(),userId,q.currency,q.minor,termsVersion]);
        const row = (await db.query(`SELECT * FROM ${S}.subscriptions WHERE user_id=$1 AND state NOT IN ('cancelled','expired')`,[userId])).rows[0];
        if (!row || row.currency !== currency || row.terms_version !== termsVersion) throw Error('EXISTING_SUBSCRIPTION');
        return row;
      });
    },
    async findSubscription(paypalId) {
      return (await pool.query(`SELECT * FROM ${S}.subscriptions WHERE paypal_id=$1`,[paypalId])).rows[0] ?? null;
    },
    async findPayment(transactionId) {
      return (await pool.query(`SELECT s.* FROM ${S}.payments p JOIN ${S}.subscriptions s ON s.id=p.subscription_id
        WHERE p.transaction_id=$1`,[transactionId])).rows[0] ?? null;
    },
    async get(userId, id) {
      return (await pool.query(`SELECT * FROM ${S}.subscriptions WHERE user_id=$1 AND id=$2`,[userId,id])).rows[0] ?? null;
    },
    async paidPeriod(userId, id, transactionId) {
      const row = (await pool.query(`SELECT r.period_start,r.period_end FROM ${S}.periods r
        JOIN ${S}.payments p ON p.transaction_id=r.transaction_id
        JOIN ${S}.subscriptions s ON s.id=p.subscription_id
        WHERE s.user_id=$1 AND s.id=$2 AND p.transaction_id=$3`,[userId,id,transactionId])).rows[0];
      return row ? { periodStart:new Date(row.period_start).toISOString(), periodEnd:new Date(row.period_end).toISOString() } : null;
    },
    async providerState(userId, id, state) {
      const states={ACTIVE:'active',SUSPENDED:'suspended',CANCELLED:'cancelled',EXPIRED:'expired',
        APPROVAL_PENDING:'approval_pending',APPROVED:'approval_pending'};
      if (!Object.hasOwn(states,state)) throw Error('INVALID_SUBSCRIPTION_STATE');
      await pool.query(`UPDATE ${S}.subscriptions SET state=$3,updated_at=now()
        WHERE user_id=$1 AND id=$2 AND state NOT IN ('cancelled','expired')`,[userId,id,states[state]]);
    },
    async holdTransaction(transactionId, reason) {
      if (!/^[A-Za-z0-9-]{3,50}$/.test(transactionId ?? '') || !['REFUNDED','REVERSED','DISPUTED'].includes(reason)) throw Error('INVALID_HOLD');
      await pool.query(`INSERT INTO ${S}.adverse_transactions(transaction_id,reason) VALUES ($1,$2)
        ON CONFLICT DO NOTHING`,[transactionId,reason]);
    },
    async entitlement(userId, now = Date.now()) {
      if (!Number.isFinite(now)) throw Error('INVALID_TIME');
      const row = (await pool.query(`SELECT max(period_end) AS until FROM ${S}.entitlement_periods
        WHERE user_id=$1 AND period_start <= $2 AND period_end > $2`,[userId,new Date(now)])).rows[0];
      const until = row?.until ? new Date(row.until).toISOString() : null;
      return { environment:mode, plan:until ? 'pro' : 'free', proExpiresAt:until };
    },
    async hasReviewHold(userId, id) {
      const row = (await pool.query(`SELECT EXISTS (
        SELECT 1 FROM ${S}.subscriptions s WHERE s.user_id=$1 AND s.id=$2 AND (
          EXISTS (SELECT 1 FROM ${S}.review_holds h WHERE h.subscription_id=s.id) OR
          EXISTS (SELECT 1 FROM ${S}.payments p JOIN ${S}.adverse_transactions a USING(transaction_id)
            WHERE p.subscription_id=s.id)
        )) AS held`,[userId,id])).rows[0];
      return row?.held === true;
    },
    async hold(userId, id, reason) {
      if (!['REFUNDED','PARTIALLY_REFUNDED','REVERSED','DISPUTED'].includes(reason)) throw Error('INVALID_HOLD');
      const row = await this.get(userId,id);
      if (!row) throw Error('SUBSCRIPTION_NOT_FOUND');
      await pool.query(`INSERT INTO ${S}.review_holds(subscription_id,reason) VALUES ($1,$2) ON CONFLICT DO NOTHING`,[id,reason]);
      // Sticky until reviewed; a late completion must never remove this hold.
    },
    async grantPeriod(userId, id, {transactionId, periodStart, periodEnd}) {
      const start=Date.parse(periodStart), end=Date.parse(periodEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw Error('INVALID_PERIOD');
      return transaction(async db => {
        const paid = (await db.query(`SELECT p.* FROM ${S}.payments p JOIN ${S}.subscriptions s ON s.id=p.subscription_id
          WHERE p.transaction_id=$1 AND p.subscription_id=$2 AND s.user_id=$3 FOR UPDATE OF s`,[transactionId,id,userId])).rows[0];
        if (!paid || new Date(paid.paid_at).getTime() < start || new Date(paid.paid_at).getTime() >= end) throw Error('PAYMENT_MISMATCH');
        await db.query(`INSERT INTO ${S}.periods(transaction_id,period_start,period_end) VALUES ($1,$2,$3)
          ON CONFLICT DO NOTHING`,[transactionId,new Date(start),new Date(end)]);
        const old=(await db.query(`SELECT * FROM ${S}.periods WHERE transaction_id=$1`,[transactionId])).rows[0];
        if (new Date(old.period_start).getTime() !== start || new Date(old.period_end).getTime() !== end) throw Error('PERIOD_CONFLICT');
      });
    },
    async attach(userId, id, paypalId) {
      if (!/^I-[A-Z0-9]{8,32}$/.test(paypalId)) throw Error('INVALID_SUBSCRIPTION');
      const result = await pool.query(`UPDATE ${S}.subscriptions SET paypal_id=$3,state='approval_pending',updated_at=now()
        WHERE user_id=$1 AND id=$2 AND state='creating' AND paypal_id IS NULL RETURNING *`,[userId,id,paypalId]);
      if (result.rows[0]) return result.rows[0];
      const row = await this.get(userId,id);
      if (!row || row.paypal_id !== paypalId) throw Error('SUBSCRIPTION_CONFLICT');
      return row;
    },
    async cancelled(userId, id) {
      const result = await pool.query(`UPDATE ${S}.subscriptions SET state='cancelled',updated_at=now()
        WHERE user_id=$1 AND id=$2 AND paypal_id IS NOT NULL RETURNING *`,[userId,id]);
      if (!result.rows[0]) throw Error('SUBSCRIPTION_NOT_FOUND');
      return result.rows[0]; // Never delete payment history or paid access on cancellation.
    },
    // Caller must first verify webhook signature AND independently reconcile the payment
    // with PayPal. This persistence method alone is never an entitlement authority.
    async recordPayment({ eventId, eventType, id, transactionId, currency, minor, paidAt }) {
      if (![eventId,eventType,transactionId].every(v => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(v)) ||
          !Number.isFinite(Date.parse(paidAt))) throw Error('INVALID_PAYMENT');
      return transaction(async db => {
        const sub = (await db.query(`SELECT * FROM ${S}.subscriptions WHERE id=$1 FOR UPDATE`,[id])).rows[0];
        if (!sub || sub.currency !== currency || sub.minor !== minor) throw Error('PAYMENT_MISMATCH');
        const event = await db.query(`INSERT INTO ${S}.events(event_id,event_type,subscription_id,transaction_id) VALUES ($1,$2,$3,$4)
          ON CONFLICT DO NOTHING RETURNING event_id`,[eventId,eventType,id,transactionId]);
        if (!event.rows.length) {
          const old = (await db.query(`SELECT * FROM ${S}.events WHERE event_id=$1`,[eventId])).rows[0];
          if (old.subscription_id !== id || old.event_type !== eventType || old.transaction_id !== transactionId) throw Error('EVENT_CONFLICT');
          const oldPayment = (await db.query(`SELECT * FROM ${S}.payments WHERE transaction_id=$1`,[transactionId])).rows[0];
          if (!oldPayment || oldPayment.currency !== currency || oldPayment.minor !== minor ||
              new Date(oldPayment.paid_at).getTime() !== Date.parse(paidAt)) throw Error('PAYMENT_CONFLICT');
          return false;
        }
        const paid = await db.query(`INSERT INTO ${S}.payments(transaction_id,subscription_id,currency,minor,paid_at)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING transaction_id`,[transactionId,id,currency,minor,paidAt]);
        if (!paid.rows.length) {
          const old = (await db.query(`SELECT * FROM ${S}.payments WHERE transaction_id=$1`,[transactionId])).rows[0];
          if (old.subscription_id !== id || old.currency !== currency || old.minor !== minor ||
              new Date(old.paid_at).getTime() !== Date.parse(paidAt)) throw Error('PAYMENT_CONFLICT');
        }
        return Boolean(paid.rows.length);
      });
    },
  };
}
