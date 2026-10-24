import { randomUUID } from 'node:crypto';
import { addYear, reject } from './policy.mjs';
import { sandboxAccess } from './access.mjs';
const iso = row => row && Object.fromEntries(Object.entries(row).map(([k,v]) => [k,v instanceof Date ? v.toISOString() : v]));
export function paymentStore(pool, { environment = 'sandbox' } = {}) {
  if (!['sandbox', 'live'].includes(environment)) throw Error('Invalid payment ledger');
  // Selected by server wiring only; never interpolate request input as a schema.
  const S = environment === 'live' ? 'resolute_payments_live' : 'resolute_payments_sandbox';
  const grantAudit = environment === 'live' ? 'LIVE_ACCESS_GRANTED' : 'SANDBOX_ACCESS_GRANTED';
  async function tx(user, fn) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SET LOCAL lock_timeout = '2s'");
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, $2))', [user, environment === 'live' ? 0 : 617]);
      const result = await fn(db); await db.query('COMMIT'); return result;
    } catch (e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
  }
  async function audit(db, orderId, code, alert = false, dedupKey = null) {
    const { rows } = await db.query(`INSERT INTO ${S}.audit(order_id,code,dedup_key) VALUES ($1,$2,$3) ON CONFLICT (dedup_key) DO NOTHING RETURNING id`, [orderId, code, dedupKey]);
    if (alert && rows.length) await db.query(`INSERT INTO ${S}.alert_outbox(audit_id) VALUES ($1)`, [rows[0].id]);
  }
  async function rights(db, user, now) {
    // Purchase eligibility must require the same verified ledger relationship as access.
    // An active grant alone cannot override a held/refunded or mismatched order.
    const { rows } = await db.query(`SELECT g.kind, g.starts_at, g.expires_at
      FROM ${S}.grants g JOIN ${S}.orders o ON o.id=g.order_id
      WHERE g.user_id=$1 AND o.user_id=$1 AND g.state='active' AND o.state='paid'
        AND o.quote->>'product'='resolute_v1' AND o.quote->>'kind'=g.kind
        AND o.capture_id IS NOT NULL AND o.paid_at IS NOT NULL`, [user]);
    return { use: rows.some(r => r.kind === 'initial' && Date.parse(r.starts_at) <= now),
      until: rows.reduce((max,r) => Math.max(max, Date.parse(r.expires_at)), 0) };
  }
  async function get(id) {
    const { rows } = await pool.query(`SELECT * FROM ${S}.orders WHERE id=$1`, [id]); return iso(rows[0]);
  }
  return { tx, audit, rights, get,
    async access(user) {
      if (environment !== 'sandbox') throw Error('Use the live entitlement reader');
      if (!/^user_[A-Za-z0-9]{1,128}$/.test(user)) reject('AUTH_REQUIRED',401);
      // One statement gives a consistent clock and snapshot across refund/capture commits.
      const { rows } = await pool.query(`SELECT statement_timestamp() AS as_of,
        g.kind,g.state,g.starts_at,g.expires_at,o.state AS order_state
        FROM (SELECT $1::text AS user_id) subject
        LEFT JOIN ${S}.grants g ON g.user_id=subject.user_id
        LEFT JOIN ${S}.orders o ON o.id=g.order_id AND o.user_id=subject.user_id
          AND o.quote->>'product'='resolute_v1' AND o.quote->>'kind'=g.kind
          AND o.capture_id IS NOT NULL AND o.paid_at IS NOT NULL`, [user]);
      if (!rows.length) throw Error('Missing access snapshot');
      return sandboxAccess(rows.filter(row=>row.kind !== null),new Date(rows[0].as_of).toISOString());
    },
    async create(user, key, makeQuote, now) {
      return tx(user, async db => {
        const existing = await db.query(`SELECT * FROM ${S}.orders WHERE user_id=$1 AND request_key=$2`, [user,key]);
        if (existing.rows.length) return iso(existing.rows[0]);
        const pending = await db.query(`SELECT count(*)::int AS n FROM ${S}.orders WHERE user_id=$1 AND state IN ('creating','created','capturing') AND expires_at>$2`, [user,new Date(now)]);
        if (pending.rows[0].n >= 3) reject('TOO_MANY_ORDERS', 429);
        const q = await makeQuote(await rights(db,user,now));
        const { rows } = await db.query(`INSERT INTO ${S}.orders(id,user_id,request_key,capture_key,quote,state,created_at,expires_at)
          VALUES ($1,$2,$3,$4,$5,'creating',$6,$7) RETURNING *`, [randomUUID(),user,key,randomUUID(),q,new Date(now),new Date(now+15*60000)]);
        await audit(db,rows[0].id,'ORDER_CREATED'); return iso(rows[0]);
      });
    },
    async bind(order, paypalId) {
      return tx(order.user_id, async db => {
        await db.query(`UPDATE ${S}.orders SET paypal_id=$2,state='created' WHERE id=$1 AND state='creating' AND (paypal_id IS NULL OR paypal_id=$2)`, [order.id,paypalId]);
        const { rows } = await db.query(`SELECT * FROM ${S}.orders WHERE id=$1`,[order.id]);
        if (rows[0]?.paypal_id !== paypalId) reject('PAYMENT_MISMATCH'); return iso(rows[0]);
      });
    },
    async prepare(order, member, now, verifyQuote) {
      return tx(order.user_id, async db => {
        const { rows } = await db.query(`SELECT * FROM ${S}.orders WHERE id=$1 FOR UPDATE`,[order.id]);
        const current=iso(rows[0]);
        if(current.state !== 'created') reject('ORDER_NOT_CAPTURABLE');
        if(Date.parse(current.expires_at) <= now) reject('ORDER_EXPIRED');
        await verifyQuote(current, await rights(db,order.user_id,now));
        await db.query(`UPDATE ${S}.orders SET state='capturing',capture_checked_at=$2,capture_pro_until=$3 WHERE id=$1`,[order.id,new Date(now),member.proUntil]);
        await audit(db,order.id,'CAPTURE_AUTHORIZED');
        return { ...current,state:'capturing',capture_checked_at:new Date(now).toISOString(),capture_pro_until:member.proUntil };
      });
    },
    async refreshCapture(order, member, now) {
      return tx(order.user_id, async db => {
        const { rows } = await db.query(`UPDATE ${S}.orders SET capture_checked_at=$2,capture_pro_until=$3
          WHERE id=$1 AND state='capturing' AND expires_at>$2 RETURNING *`,[order.id,new Date(now),member.proUntil]);
        if(!rows.length) reject('ORDER_NOT_CAPTURABLE');
        return iso(rows[0]);
      });
    },
    async paid(order, payment) {
      return tx(order.user_id, async db => {
        const { rows } = await db.query(`SELECT * FROM ${S}.orders WHERE id=$1 FOR UPDATE`,[order.id]);
        const current=rows[0];
        if(current.state === 'paid') { if(current.capture_id !== payment.captureId) reject('PAYMENT_MISMATCH'); return 'already-paid'; }
        // A late success must NEVER undo a refund, hold or dispute.
        if(current.state !== 'capturing') return 'review-required';
        const now=Date.parse(payment.paidAt), r=await rights(db,order.user_id,now);
        if(order.quote.kind === 'renewal' && !r.use || order.quote.kind === 'initial' && r.use) {
          await db.query(`UPDATE ${S}.orders SET state='held',capture_id=$2,paid_at=$3 WHERE id=$1`,[order.id,payment.captureId,payment.paidAt]);
          await audit(db,order.id,'ELIGIBILITY_CHANGED',true); return 'review-required';
        }
        const start=order.quote.kind === 'renewal' ? Math.max(now,r.until) : now;
        await db.query(`INSERT INTO ${S}.grants(order_id,user_id,kind,starts_at,expires_at) VALUES ($1,$2,$3,$4,$5)`,
          [order.id,order.user_id,order.quote.kind,new Date(start),addYear(start)]);
        await db.query(`UPDATE ${S}.orders SET state='paid',capture_id=$2,paid_at=$3 WHERE id=$1`,[order.id,payment.captureId,payment.paidAt]);
        await audit(db,order.id,grantAudit); return 'paid';
      });
    },
    async adverse(paypalId, state, code, eventId) {
      const { rows }=await pool.query(`SELECT * FROM ${S}.orders WHERE paypal_id=$1`,[paypalId]);
      if(!rows.length) reject('UNKNOWN_PAYMENT',503);
      const order=rows[0];
      return tx(order.user_id,async db=>{
        // Revocation is terminal; suspension requires an explicit reviewed restoration.
        await db.query(`UPDATE ${S}.orders SET state=$2 WHERE id=$1 AND state<>'revoked'`,[order.id,state]);
        await db.query(`UPDATE ${S}.grants SET state=$2 WHERE order_id=$1 AND state<>'revoked'`,[order.id,state]);
        await audit(db,order.id,code,true,`${eventId}:${order.id}`);
      });
    },
    async findPaypal(paypalId) {
      const {rows}=await pool.query(`SELECT * FROM ${S}.orders WHERE paypal_id=$1`,[paypalId]);return iso(rows[0]);
    },
    async findCapture(captureId) {
      const {rows}=await pool.query(`SELECT * FROM ${S}.orders WHERE capture_id=$1`,[captureId]);return iso(rows[0]);
    },
    async eventSeen(eventId,digest) {
      const {rows}=await pool.query(`SELECT digest FROM ${S}.events WHERE id=$1`,[eventId]);
      if(rows.length && rows[0].digest !== digest) reject('EVENT_COLLISION',400);
      return Boolean(rows.length);
    },
    async eventDone(eventId,digest) {
      await pool.query(`INSERT INTO ${S}.events(id,digest) VALUES ($1,$2) ON CONFLICT DO NOTHING`,[eventId,digest]);
    },
    async flag(order,code) { await tx(order?.user_id ?? 'unmatched',db=>audit(db,order?.id ?? null,code,true,`${order?.id ?? 'unmatched'}:${code}:${Math.floor(Date.now()/60000)}`)); },
    async auditList() { return (await pool.query(`SELECT a.id,a.order_id,a.code,a.created_at,o.delivered_at FROM ${S}.audit a
      LEFT JOIN ${S}.alert_outbox o ON o.audit_id=a.id ORDER BY a.id DESC LIMIT 100`)).rows; },
  };
}
