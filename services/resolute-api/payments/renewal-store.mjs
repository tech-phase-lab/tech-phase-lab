import { createHash, randomUUID } from 'node:crypto';
import { reject } from './policy.mjs';

// RESOLUTE automatic renewal ledger (db/resolute/025_auto_renewal.sql). Every write runs inside the payment store's
// per-member transaction lock, so a renewal can never interleave with a purchase, claim, refund or another renewal.
export const AUTO_RENEWAL_CONSENT_VERSION = 'resolute-auto-renewal-v1';
export const MAX_RENEWAL_ATTEMPTS = 3;
// Declined renewals are retried on the renewal day, one day later and three days later; then the plan stops.
export const RETRY_DELAYS = Object.freeze([86400000, 2 * 86400000]);
// A charge whose answer was lost is retried with the same PayPal-Request-Id only while PayPal still remembers it.
export const SAME_KEY_WINDOW = 6 * 3600000;
export const PENDING_LIMIT = 14 * 86400000;
const iso = row => row && Object.fromEntries(Object.entries(row).map(([k,v]) => [k,v instanceof Date ? v.toISOString() : v]));
export const noticeKey = (user, periodEnd, kind) =>
  createHash('sha256').update(`resolute-renewal-notice-v1\n${user}\n${new Date(periodEnd).toISOString()}\n${kind}`).digest('hex').slice(0, 32);
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);

export function renewalStore(pool, store, { environment = 'live' } = {}) {
  if (!['sandbox', 'live'].includes(environment)) throw Error('Invalid payment ledger');
  const S = environment === 'live' ? 'resolute_payments_live' : 'resolute_payments_sandbox';
  const plan = async (db, user, lock = false) => iso((await db.query(`SELECT * FROM ${S}.renewal_plans WHERE user_id=$1${lock ? ' FOR UPDATE' : ''}`, [user])).rows[0]);
  return {
    /** Mark a new signed-in first-purchase order (still 'creating', not yet sent to PayPal) as asking to save PayPal. */
    async offer(order) {
      // Guests (no account) cannot see or stop a renewal on the account screen, so their orders never ask.
      const { rows } = await pool.query(`UPDATE ${S}.orders SET auto_renewal_offered=true WHERE id=$1 AND state='creating'
        AND quote->>'kind'='initial' ${environment === 'live' ? 'AND guest_id IS NULL ' : ''}AND user_id ~ '^user_' RETURNING *`, [order.id]);
      return rows.length ? iso(rows[0]) : order;
    },
    /** The member pressed the agree button on a screen that showed the auto-renewal line. */
    async consent(order, now) {
      await pool.query(`UPDATE ${S}.orders SET auto_renewal_consent_at=$2 WHERE id=$1 AND auto_renewal_offered
        AND auto_renewal_consent_at IS NULL AND state='capturing'`, [order.id, new Date(now)]);
    },
    /** Save the PayPal vault token for a paid first purchase whose buyer consented. Idempotent per member. */
    async enroll(orderId, vault, now) {
      if (!validToken(vault?.id) || (vault.customer != null && !validToken(vault.customer))) reject('INVALID_EVENT', 400);
      const order = iso((await pool.query(`SELECT * FROM ${S}.orders WHERE id=$1`, [orderId])).rows[0]);
      if (!order) reject('UNKNOWN_PAYMENT', 503);
      return store.tx(order.user_id, async db => {
        const { rows } = await db.query(`SELECT o.*, g.expires_at AS grant_expires_at FROM ${S}.orders o
          JOIN ${S}.grants g ON g.order_id=o.id AND g.user_id=o.user_id AND g.state='active'
          WHERE o.id=$1 AND o.state='paid' AND o.auto_renewal_offered AND o.auto_renewal_consent_at IS NOT NULL
            AND o.quote->>'kind'='initial' AND o.user_id ~ '^user_' FOR UPDATE OF o`, [orderId]);
        const paid = iso(rows[0]);
        if (!paid) return 'not-eligible';
        const existing = await plan(db, paid.user_id, true);
        if (existing) return existing.token_id === vault.id ? 'already-enrolled' : 'not-eligible';
        await db.query(`INSERT INTO ${S}.renewal_plans(user_id,source_order_id,token_id,customer_id,language,consent_at,consent_version,next_renewal_at,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`, [paid.user_id, paid.id, vault.id, vault.customer ?? null, paid.quote.language,
          paid.auto_renewal_consent_at, AUTO_RENEWAL_CONSENT_VERSION, paid.grant_expires_at, new Date(now)]);
        await store.audit(db, paid.id, 'AUTO_RENEWAL_ENROLLED');
        return 'enrolled';
      });
    },
    async findOrderByPaypal(paypalId) {
      return iso((await pool.query(`SELECT * FROM ${S}.orders WHERE paypal_id=$1`, [paypalId])).rows[0]);
    },
    /** The buyer removed the saved PayPal (in PayPal) — no more automatic charges; manual renewal still works. */
    async tokenDeleted(tokenId) {
      if (!validToken(tokenId)) reject('INVALID_EVENT', 400);
      const row = iso((await pool.query(`SELECT * FROM ${S}.renewal_plans WHERE token_id=$1`, [tokenId])).rows[0]);
      if (!row) return 'unknown';
      return store.tx(row.user_id, async db => {
        await db.query(`UPDATE ${S}.renewal_plans SET state='ended',end_reason='PAYPAL_TOKEN_DELETED',updated_at=now()
          WHERE user_id=$1 AND state IN ('active','stopped')`, [row.user_id]);
        await store.audit(db, row.source_order_id, 'AUTO_RENEWAL_TOKEN_DELETED');
        return 'ended';
      });
    },
    /** What the account screen shows. Never the token, customer id or amounts. */
    async view(user) {
      const row = await plan(pool, user);
      if (!row) return { available: false, enabled: false, state: null, nextRenewalAt: null };
      return { available: ['active', 'stopped'].includes(row.state), enabled: row.state === 'active', state: row.state,
        nextRenewalAt: row.next_renewal_at };
    },
    /** Stop (always allowed) or restart (only a stopped plan, before its renewal day). */
    async set(user, enabled, now) {
      return store.tx(user, async db => {
        const row = await plan(db, user, true);
        if (!row) reject('AUTO_RENEWAL_UNAVAILABLE', 404);
        if (!enabled) {
          if (row.state === 'active') {
            await db.query(`UPDATE ${S}.renewal_plans SET state='stopped',stopped_at=$2,updated_at=$2 WHERE user_id=$1`, [user, new Date(now)]);
            await store.audit(db, row.source_order_id, 'AUTO_RENEWAL_STOPPED');
          }
        } else if (row.state === 'stopped') {
          if (Date.parse(row.next_renewal_at) <= now) reject('AUTO_RENEWAL_UNAVAILABLE', 409);
          await db.query(`UPDATE ${S}.renewal_plans SET state='active',stopped_at=NULL,failures=0,next_attempt_at=NULL,updated_at=$2 WHERE user_id=$1`, [user, new Date(now)]);
          await store.audit(db, row.source_order_id, 'AUTO_RENEWAL_RESUMED');
        } else if (row.state !== 'active') reject('AUTO_RENEWAL_UNAVAILABLE', 409);
        return 'ok';
      });
    },

    // ---- renewal job
    async plansDue(now) {
      return (await pool.query(`SELECT * FROM ${S}.renewal_plans WHERE state='active' AND next_renewal_at <= $1
        AND (next_attempt_at IS NULL OR next_attempt_at <= $2) ORDER BY next_renewal_at LIMIT 50`,
        [new Date(now + 86400000), new Date(now)])).rows.map(iso);
    },
    async openCharges() {
      return (await pool.query(`SELECT c.*, p.token_id, p.language AS plan_language FROM ${S}.renewal_charges c
        JOIN ${S}.renewal_plans p ON p.user_id=c.user_id
        WHERE c.state IN ('charging','pending','uncertain') ORDER BY c.created_at LIMIT 50`)).rows.map(iso);
    },
    async order(id) { return iso((await pool.query(`SELECT * FROM ${S}.orders WHERE id=$1`, [id])).rows[0]); },
    /**
     * Start one renewal attempt: re-check the plan, the purchase and the period under the member lock, price it
     * (makeQuote), then write the order (already 'capturing', so no other capture can start) and the attempt row.
     * The partial unique index allows only one live attempt per period, so a second worker cannot charge again.
     */
    async begin(planRow, member, now, makeQuote) {
      return store.tx(planRow.user_id, async db => {
        const p = await plan(db, planRow.user_id, true);
        if (!p || p.state !== 'active' || p.next_renewal_at !== planRow.next_renewal_at) return { skip: 'changed' };
        const rights = await store.rights(db, p.user_id, now, true);
        if (!rights.use) {
          await db.query(`UPDATE ${S}.renewal_plans SET state='ended',end_reason='PURCHASE_NOT_ACTIVE',updated_at=$2 WHERE user_id=$1`, [p.user_id, new Date(now)]);
          await store.audit(db, p.source_order_id, 'AUTO_RENEWAL_ENDED', true); return { skip: 'ended' };
        }
        // Already renewed by hand (or a previous attempt landed): move the plan to the new end, charge nothing.
        if (rights.until > Date.parse(p.next_renewal_at)) {
          await db.query(`UPDATE ${S}.renewal_plans SET next_renewal_at=$2,failures=0,next_attempt_at=NULL,updated_at=$3 WHERE user_id=$1`,
            [p.user_id, new Date(rights.until), new Date(now)]);
          return { skip: 'covered' };
        }
        const live = await db.query(`SELECT 1 FROM ${S}.renewal_charges WHERE user_id=$1 AND period_end=$2
          AND state IN ('charging','pending','uncertain','paid','review')`, [p.user_id, new Date(p.next_renewal_at)]);
        if (live.rows.length) return { skip: 'in-flight' };
        const tries = (await db.query(`SELECT count(*)::int AS n FROM ${S}.renewal_charges WHERE user_id=$1 AND period_end=$2`,
          [p.user_id, new Date(p.next_renewal_at)])).rows[0].n;
        if (tries >= MAX_RENEWAL_ATTEMPTS) return { skip: 'exhausted' };
        const q = makeQuote(rights);
        const { rows } = await db.query(`INSERT INTO ${S}.orders(id,user_id,request_key,capture_key,quote,state,created_at,expires_at,capture_checked_at,capture_pro_until)
          VALUES ($1,$2,$3,$4,$5,'capturing',$6,$7,$6,$8) RETURNING *`,
          [randomUUID(), p.user_id, randomUUID(), randomUUID(), q, new Date(now), new Date(now + PENDING_LIMIT), member.proUntil]);
        const order = iso(rows[0]);
        await db.query(`INSERT INTO ${S}.renewal_charges(order_id,user_id,period_end,attempt,state,created_at,updated_at)
          VALUES ($1,$2,$3,$4,'charging',$5,$5)`, [order.id, p.user_id, new Date(p.next_renewal_at), tries + 1, new Date(now)]);
        await store.audit(db, order.id, 'AUTO_RENEWAL_CHARGE_STARTED');
        return { order, attempt: tries + 1 };
      });
    },
    async bindPaypal(order, paypalId) {
      if (!/^[A-Z0-9]{8,32}$/.test(paypalId ?? '')) reject('PAYMENT_MISMATCH');
      const { rows } = await pool.query(`UPDATE ${S}.orders SET paypal_id=$2 WHERE id=$1 AND (paypal_id IS NULL OR paypal_id=$2) RETURNING *`, [order.id, paypalId]);
      if (!rows.length) reject('PAYMENT_MISMATCH');
      return iso(rows[0]);
    },
    async mark(order, state, now) {
      await pool.query(`UPDATE ${S}.renewal_charges SET state=$2,updated_at=$3 WHERE order_id=$1 AND state IN ('charging','pending','uncertain')`,
        [order.id, state, new Date(now)]);
    },
    /** The renewal payment was verified and the year granted (store.paid): move the plan to the new end. */
    async paid(order, now) {
      return store.tx(order.user_id, async db => {
        await db.query(`UPDATE ${S}.renewal_charges SET state='paid',updated_at=$2 WHERE order_id=$1`, [order.id, new Date(now)]);
        const g = (await db.query(`SELECT expires_at FROM ${S}.grants WHERE order_id=$1`, [order.id])).rows[0];
        if (g) await db.query(`UPDATE ${S}.renewal_plans SET next_renewal_at=$2,failures=0,next_attempt_at=NULL,updated_at=$3 WHERE user_id=$1`,
          [order.user_id, g.expires_at, new Date(now)]);
        await store.audit(db, order.id, 'AUTO_RENEWAL_PAID');
      });
    },
    /** PayPal refused the charge: nothing was taken. Retry later, or stop after the last attempt (and tell the member). */
    async declined(order, attempt, now) {
      return store.tx(order.user_id, async db => {
        await db.query(`UPDATE ${S}.orders SET state='declined' WHERE id=$1 AND state='capturing'`, [order.id]);
        await db.query(`UPDATE ${S}.renewal_charges SET state='declined',updated_at=$2 WHERE order_id=$1`, [order.id, new Date(now)]);
        const last = attempt >= MAX_RENEWAL_ATTEMPTS;
        await db.query(`UPDATE ${S}.renewal_plans SET failures=$2,state=CASE WHEN $3 THEN 'failed' ELSE state END,
          end_reason=CASE WHEN $3 THEN 'DECLINED' ELSE end_reason END,next_attempt_at=$4,updated_at=$5 WHERE user_id=$1`,
          [order.user_id, Math.min(attempt, MAX_RENEWAL_ATTEMPTS), last, last ? null : new Date(now + RETRY_DELAYS[attempt - 1]), new Date(now)]);
        await store.audit(db, order.id, last ? 'AUTO_RENEWAL_FAILED' : 'AUTO_RENEWAL_DECLINED', last);
        return last ? 'failed' : 'retry';
      });
    },
    /** The account can no longer be charged (deleted, locked, email unverified): end the plan, charge nothing. */
    async end(user, reason, now) {
      return store.tx(user, async db => {
        const p = await plan(db, user, true);
        if (!p || p.state !== 'active') return;
        await db.query(`UPDATE ${S}.renewal_plans SET state='ended',end_reason=$2,updated_at=$3 WHERE user_id=$1`, [user, reason, new Date(now)]);
        await store.audit(db, p.source_order_id, 'AUTO_RENEWAL_ENDED', true);
      });
    },
    /** Unknown outcome that can no longer be settled safely: stop the plan and ask the operator; never charge again. */
    async review(order, code, now) {
      return store.tx(order.user_id, async db => {
        await db.query(`UPDATE ${S}.renewal_charges SET state='review',updated_at=$2 WHERE order_id=$1`, [order.id, new Date(now)]);
        await db.query(`UPDATE ${S}.renewal_plans SET state='review',end_reason=$2,updated_at=$3 WHERE user_id=$1`, [order.user_id, code, new Date(now)]);
        await store.audit(db, order.id, code, true);
      });
    },

    // ---- notices (7 days before; and after a final failure)
    async noticesDue(now) {
      const week = new Date(now + 7 * 86400000), at = new Date(now);
      const auto = (await pool.query(`SELECT user_id, next_renewal_at AS period_end, language, 'upcoming_auto' AS kind FROM ${S}.renewal_plans
        WHERE state='active' AND next_renewal_at > $1 AND next_renewal_at <= $2`, [at, week])).rows;
      const failed = (await pool.query(`SELECT user_id, next_renewal_at AS period_end, language, 'failed' AS kind FROM ${S}.renewal_plans
        WHERE state='failed' AND updated_at > $1`, [new Date(now - 7 * 86400000)])).rows;
      // Everyone else whose alerts end within a week (no saved PayPal, stopped, bank/guest payers…): the notice
      // that renewal is open, as before — only those who choose to renew are renewed.
      const manual = (await pool.query(`SELECT e.user_id, e.period_end, COALESCE((SELECT o.quote->>'language' FROM ${S}.orders o
          WHERE o.user_id=e.user_id AND o.state='paid' ORDER BY o.paid_at DESC LIMIT 1),'ja') AS language, 'upcoming_manual' AS kind
        FROM (SELECT g.user_id, max(g.expires_at) AS period_end FROM ${S}.grants g JOIN ${S}.orders o ON o.id=g.order_id AND o.user_id=g.user_id
          WHERE g.state='active' AND o.state='paid' GROUP BY g.user_id) e
        WHERE e.period_end > $1 AND e.period_end <= $2
          AND NOT EXISTS (SELECT 1 FROM ${S}.renewal_plans p WHERE p.user_id=e.user_id AND p.state='active')`, [at, week])).rows;
      return [...auto, ...failed, ...manual].map(iso).map(r => ({ ...r, key: noticeKey(r.user_id, r.period_end, r.kind) }));
    },
    /** Claim before sending. A notice already accepted (push/mail) is never sent again; a failed one is retried a few times. */
    async claimNotice(n, now) {
      const { rows } = await pool.query(`INSERT INTO ${S}.renewal_notices(notice_key,user_id,period_end,kind,state,attempts,created_at,updated_at)
        VALUES ($1,$2,$3,$4,'claimed',1,$5,$5) ON CONFLICT (notice_key) DO UPDATE SET state='claimed',attempts=${S}.renewal_notices.attempts+1,updated_at=$5
        WHERE ${S}.renewal_notices.state='failed' AND ${S}.renewal_notices.attempts<3 RETURNING notice_key`,
        [n.key, n.user_id, new Date(n.period_end), n.kind, new Date(now)]);
      return rows.length > 0;
    },
    async finishNotice(n, state, now) {
      await pool.query(`UPDATE ${S}.renewal_notices SET state=$2,updated_at=$3 WHERE notice_key=$1 AND state='claimed'`, [n.key, state, new Date(now)]);
    },
  };
}
