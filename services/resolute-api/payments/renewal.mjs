import { readJson } from './paypal.mjs';
import { identity, quote, verifyOrder } from './policy.mjs';
import { SAME_KEY_WINDOW, PENDING_LIMIT } from './renewal-store.mjs';

// RESOLUTE automatic renewal job (owner request 2026-11-19). One run:
//  1. settles renewal charges whose answer is not final yet (lost answer, bank-funded PENDING capture),
//  2. charges plans whose renewal day (JST) has come, with the saved PayPal and the renewal price of that moment
//     (PRO members get the member price, read from Clerk on the server at charge time),
//  3. sends the 7-days-before notice by phone (Web Push) and by email to those the phone notice did not reach,
//     plus the "could not renew" notice after the last declined attempt.
// Never: a second charge for the same period, a charge without a saved PayPal and recorded consent, a retry after an
// unknown result outside PayPal's idempotency window, or any change to refunds (those stay webhook-driven).
export const ACCOUNT_PAGE = '/research/account';
const JST = 9 * 3600000;
export function renewalDayStart(iso) {
  const d = new Date(Date.parse(iso) + JST);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - JST;
}
const PRICES = { ja: ['5,980円', '3,980円'], en: ['$39', '$29'] };
function day(iso, language) {
  const d = new Date(Date.parse(iso) + JST);
  return language === 'en'
    ? `${['January','February','March','April','May','June','July','August','September','October','November','December'][d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
    : `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}
/** Phone text (≤120 characters), email subject and body. No amounts beyond the published renewal prices. */
export function renewalMessage(kind, language, periodEnd, origin) {
  const en = language === 'en', date = day(periodEnd, language), [free, pro] = PRICES[en ? 'en' : 'ja'];
  const link = `${origin}${ACCOUNT_PAGE}${en ? '?lang=en' : ''}`;
  const text = {
    upcoming_auto: en
      ? [`Your RESOLUTE alerts renew automatically on ${date} (${free}, PRO ${pro}). Stop anytime on your account page.`,
        'RESOLUTE: your alerts renew automatically in 7 days',
        `Your RESOLUTE alerts renew automatically on ${date}. The renewal is ${free} (${pro} for Tech Phase PRO members on the renewal date), paid with the PayPal you saved at purchase.\n\nYou can stop automatic renewal anytime on your account page:\n${link}`]
      : [`${date}に通知機能が自動で更新されます（${free}・PRO会員${pro}）。止めるときはアカウント画面から。`,
        'RESOLUTE 通知機能の自動更新のお知らせ（7日前）',
        `RESOLUTEの通知機能は${date}に自動で更新されます。更新料金は${free}（更新日にTech Phase PRO会員の方は${pro}）で、購入時に保存したPayPalでお支払いいただきます。\n\n自動更新はアカウント画面からいつでも止められます。\n${link}`],
    upcoming_manual: en
      ? [`Your RESOLUTE alerts end on ${date}. To renew (${free}, PRO ${pro}), go to your account page.`,
        'RESOLUTE: your alerts end in 7 days',
        `Your RESOLUTE alerts end on ${date}. Renewal is ${free} (${pro} for Tech Phase PRO members). Only those who choose to renew are renewed.\n\n${link}`]
      : [`通知機能の有効期限は${date}です。更新を希望する場合は、アカウント画面から手続きできます（${free}・PRO会員${pro}）。`,
        'RESOLUTE 通知機能の更新時期のお知らせ',
        `RESOLUTEの通知機能の有効期限は${date}です。更新料金は${free}（Tech Phase PRO会員の方は${pro}）です。ご希望の方だけ更新します。\n\n${link}`],
    failed: en
      ? ["We couldn't renew your RESOLUTE alerts automatically. Please check your PayPal and renew from your account page.",
        "RESOLUTE: we couldn't renew your alerts",
        `We couldn't renew your RESOLUTE alerts automatically with your saved PayPal, so we have stopped trying and nothing was charged. Please check your PayPal payment method, then renew from your account page if you'd like to continue.\n\n${link}`]
      : ['通知機能の自動更新ができませんでした。PayPalのお支払い方法をご確認のうえ、アカウント画面から更新してください。',
        'RESOLUTE 通知機能を自動で更新できませんでした',
        `保存されたPayPalで通知機能を自動で更新できなかったため、自動更新を止めました。料金は請求していません。PayPalのお支払い方法をご確認のうえ、続ける場合はアカウント画面から更新してください。\n\n${link}`],
  }[kind];
  if (!text) throw Error('Unknown renewal notice');
  return { push: { title: 'RESOLUTE', body: text[0], url: ACCOUNT_PAGE }, subject: text[1], text: text[2] };
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

export function renewalJob({ store, renewals, paypal, merchantId, getUser, push = null, mail = null, origin, now = Date.now, enabled = false }) {
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
    // 3. Notices: phone first, email when no phone accepted it.
    for (const n of await renewals.noticesDue(time)) {
      try {
        if (!await renewals.claimNotice(n, time)) continue;
        const message = renewalMessage(n.kind, n.language, n.period_end, origin);
        let state = 'failed';
        if (push) {
          try { if ((await push.send({ userId: n.user_id, key: n.key, notice: message.push }, AbortSignal.timeout(8000))).accepted > 0) state = 'push'; }
          catch { /* the email below */ }
        }
        if (state === 'failed' && mail) {
          try {
            const to = primaryEmail(await getUser(n.user_id));
            if (to) { await mail.send(n.key, to, { subject: message.subject, text: message.text }); state = 'mail'; }
          } catch { /* retried next run (claimNotice allows a few attempts) */ }
        }
        await renewals.finishNotice(n, state, time);
        report[state === 'failed' ? 'noticeErrors' : 'notices']++;
      } catch { report.noticeErrors++; }
    }
    return report;
  };
}
