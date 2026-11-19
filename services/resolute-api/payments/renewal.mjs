import { readJson } from './paypal.mjs';
import { identity, quote, verifyOrder } from './policy.mjs';
import { SAME_KEY_WINDOW, PENDING_LIMIT } from './renewal-store.mjs';

// RESOLUTE automatic renewal job (owner request 2026-11-19). One run:
//  1. settles renewal charges whose answer is not final yet (lost answer, bank-funded PENDING capture),
//  2. charges plans whose renewal day (JST) has come, with the saved PayPal and the renewal price of that moment
//     (PRO members get the member price, read from Clerk on the server at charge time),
//  3. sends the renewal notice once by email 30 days before the renewal date (owner, Nov 19: as the terms say;
//     no phone notice), plus the "could not renew" email after the last declined attempt.
// Never: a second charge for the same period, a charge without a saved PayPal and recorded consent, a retry after an
// unknown result outside PayPal's idempotency window, or any change to refunds (those stay webhook-driven).
const JST = 9 * 3600000;
export function renewalDayStart(iso) {
  const d = new Date(Date.parse(iso) + JST);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - JST;
}
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
/** 「12月16日」 / "December 16, 2027" — the renewal date in JST. */
export function renewalDate(iso, language) {
  const d = new Date(Date.parse(iso) + JST);
  return language === 'en' ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}` : `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}
/** 「5,980円」 / "$39" from the quote (the renewal price for this member now; PRO members get the member price). */
export function renewalPrice(q) {
  return q.currency === 'JPY' ? `${Number(q.value).toLocaleString('en-US')}円` : `$${q.value.endsWith('.00') ? q.value.slice(0, -3) : q.value}`;
}
export const NOTICE_DAYS = 30;
/**
 * The owner's wording (Nov 19), word for word. upcoming_auto: saved PayPal, renews automatically; upcoming_manual:
 * no saved PayPal (bank/guest-page payers, stopped renewals) — renew from the account page. failed: after the last
 * declined attempt (not part of the owner's wording; plain notice that nothing was charged).
 */
export function renewalMessage(kind, language, periodEnd, price = null) {
  const en = language === 'en', date = renewalDate(periodEnd, language);
  if (kind === 'upcoming_auto') {
    if (!price) throw Error('Renewal price required');
    return en ? { subject: 'Your RESOLUTE alerts renewal',
      text: `Your RESOLUTE alerts will renew automatically for another year on ${date}. The renewal fee of ${price} will be charged to your PayPal account on file. To stop the renewal, please do so from your account page before ${date}.` }
      : { subject: 'RESOLUTE 通知機能の更新のお知らせ',
      text: `${date}に、RESOLUTEの通知機能を1年分自動で更新します。\n更新料は${price}で、ご登録のPayPalにてお支払いいただきます。\n停止をご希望の方は、更新日の前日までにアカウント画面からお手続きください。` };
  }
  if (kind === 'upcoming_manual') {
    return en ? { subject: 'Your RESOLUTE alerts renewal', text: `Your RESOLUTE alerts end on ${date}. To keep using them, please renew from your account page.` }
      : { subject: 'RESOLUTE 通知機能の更新のお知らせ', text: `${date}でRESOLUTEの通知機能のご利用期間が終わります。続けてご利用の方は、アカウント画面から更新のお手続きをお願いします。` };
  }
  if (kind === 'failed') {
    return en ? { subject: "Your RESOLUTE alerts couldn't be renewed", text: "We couldn't renew your RESOLUTE alerts automatically, so automatic renewal has stopped and nothing was charged. To keep using them, please renew from your account page." }
      : { subject: 'RESOLUTE 通知機能を自動で更新できませんでした', text: '通知機能を自動で更新できなかったため、自動更新を止めました。料金は請求していません。続けてご利用の方は、アカウント画面から更新のお手続きをお願いします。' };
  }
  throw Error('Unknown renewal notice');
}

const email = s => typeof s === 'string' && s.length <= 320 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s);
/** Verified primary address from Clerk, read on the server at send time. Never stored. */
export function primaryEmail(user) {
  const e = user?.emailAddresses?.find(x => x.id === user.primaryEmailAddressId && x.verification?.status === 'verified');
  return email(e?.emailAddress) ? e.emailAddress : null;
}

/** Resend, the same fixed API as the receipts (receipt-mail.mjs). The notice key is the idempotency key. */
export function renewalMailProvider({ apiKey, from }, request = fetch) {
  if (!/^re_[A-Za-z0-9_-]{10,200}$/.test(apiKey ?? '') || !email(from)) throw Error('Renewal mail unavailable');
  return {
    async send(key, to, mail) {
      if (!/^[a-f0-9]{32}$/.test(key) || !email(to)) throw Error('Invalid renewal notice');
      const response = await request('https://api.resend.com/emails', { method: 'POST', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(15000), headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'Idempotency-Key': 'resolute-renewal-' + key },
        body: JSON.stringify({ from, to: [to], subject: mail.subject, text: mail.text, tags: [{ name: 'resolute_renewal', value: key }] }) });
      if (!response.ok) { await response.body?.cancel(); throw Error('Renewal mail unavailable'); }
      const data = await readJson(response, 65536);
      if (typeof data.id !== 'string') throw Error('Renewal mail unavailable');
      return data.id;
    },
  };
}

export function renewalJob({ store, renewals, paypal, merchantId, getUser, mail = null, now = Date.now, enabled = false }) {
  return async () => {
    const report = { enabled, charged: 0, pending: 0, declined: 0, failed: 0, uncertain: 0, review: 0, skipped: 0, notices: 0, noticeErrors: 0, errors: 0 };
    if (!enabled) return report;
    const time = now();
    async function declined(order, attempt) {
      report[(await renewals.declined(order, attempt, time)) === 'failed' ? 'failed' : 'declined']++;
    }
    async function finish(order, remote, attempt) {
      if (!/^[A-Z0-9]{8,32}$/.test(remote?.id ?? '')) { await renewals.mark(order, 'uncertain', time); report.uncertain++; return; }
      order = await renewals.bindPaypal(order, remote.id);
      const capture = remote.purchase_units?.[0]?.payments?.captures?.[0];
      if (remote.status === 'COMPLETED' && capture?.status === 'COMPLETED') {
        let state;
        try { state = await store.paid(order, verifyOrder(order, remote, merchantId, true)); }
        catch { await renewals.review(order, 'AUTO_RENEWAL_MISMATCH', time); report.review++; return; }
        if (state === 'paid' || state === 'already-paid') { await renewals.paid(order, time); report.charged++; }
        else { await renewals.review(order, 'AUTO_RENEWAL_HELD', time); report.review++; }
      } else if (['DECLINED', 'FAILED'].includes(capture?.status) || ['VOIDED', 'PAYER_ACTION_REQUIRED'].includes(remote.status)) {
        // No money moved: PayPal refused, or wants the payer present (not possible for a renewal).
        await declined(order, attempt);
      } else if (capture?.status === 'PENDING') {
        // Typically a bank-funded PayPal payment: wait for it to clear. Never start another charge meanwhile.
        if (time - Date.parse(order.created_at) > PENDING_LIMIT) { await renewals.review(order, 'AUTO_RENEWAL_PENDING_TOO_LONG', time); report.review++; }
        else { await renewals.mark(order, 'pending', time); report.pending++; }
      } else { await renewals.mark(order, 'uncertain', time); report.uncertain++; }
    }
    async function attempt(order, token, n) {
      let remote;
      try { remote = await paypal.charge(order, token); }
      catch (e) {
        if (e?.code === 'PAYPAL_DECLINED') return declined(order, n);
        await renewals.mark(order, 'uncertain', time); report.uncertain++; return;
      }
      await finish(order, remote, n);
    }
    // 1. Unfinished charges first: they block a new charge for the same period anyway.
    for (const c of await renewals.openCharges()) {
      try {
        const order = await renewals.order(c.order_id);
        if (order.paypal_id) await finish(order, await paypal.get(order.paypal_id), c.attempt);
        else if (time - Date.parse(order.created_at) < SAME_KEY_WINDOW) await attempt(order, c.token_id, c.attempt);
        else { await renewals.review(order, 'AUTO_RENEWAL_UNCERTAIN', time); report.review++; }
      } catch { report.errors++; }
    }
    // 2. Renewal day reached (from 00:00 JST of the day the alerts end).
    for (const p of await renewals.plansDue(time)) {
      if (time < renewalDayStart(p.next_renewal_at)) continue;
      try {
        let member;
        try { member = identity(await getUser(p.user_id), time); }
        catch (e) { if (e?.code === 'VERIFIED_ACCOUNT_REQUIRED') { await renewals.end(p.user_id, 'ACCOUNT_UNAVAILABLE', time); report.skipped++; continue; } throw e; }
        if (member.userId !== p.user_id) throw Error('identity');
        const started = await renewals.begin(p, member, time, rights => quote('renewal', p.language, member, rights, time));
        if (started.skip) { report.skipped++; continue; }
        await attempt(started.order, p.token_id, started.attempt);
      } catch { report.errors++; }
    }
    // 3. Notices: one email (30 days before; after a final decline). A failed send is retried on later runs with the
    //    same Resend idempotency key, so it reaches the member at most once.
    for (const n of await renewals.noticesDue(time)) {
      try {
        if (!await renewals.claimNotice(n, time)) continue;
        let state = 'failed';
        try {
          const user = await getUser(n.user_id), to = primaryEmail(user);
          let price = null;
          if (n.kind === 'upcoming_auto') price = renewalPrice(quote('renewal', n.language, identity(user, time), { use: true }, time));
          const message = renewalMessage(n.kind, n.language, n.period_end, price);
          if (to && mail) { await mail.send(n.key, to, message); state = 'mail'; }
        } catch { /* retried next run (claimNotice allows a few attempts) */ }
        await renewals.finishNotice(n, state, time);
        report[state === 'failed' ? 'noticeErrors' : 'notices']++;
      } catch { report.noticeErrors++; }
    }
    return report;
  };
}
