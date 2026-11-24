export const LAUNCH_END = Date.parse('2027-03-01T00:00:00+09:00');
export const PRODUCT = 'resolute_v1';
export class PaymentError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
export const reject = (code, status) => { throw new PaymentError(code, status); };
export function input(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) reject('INVALID_PAYMENT_INPUT', 400);
  return value;
}
// Consent to the Terms of Service and Privacy Policy (lawyer review, Nov 24): the purchase screens send the time the buyer
// ticked 「利用規約とプライバシーポリシーに同意する」. A request without it is refused; the time is stored with the order.
// Only the format and "not in the future" (10 minutes of clock skew) are checked: it is the buyer's own clock.
export function consentTime(value, now) {
  const at = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(at) || !Number.isFinite(now) || at > now + 600000) reject('CONSENT_REQUIRED', 400);
  return new Date(at).toISOString();
}
export function identity(user, now) {
  if (!user || !/^user_[A-Za-z0-9]{1,128}$/.test(user.id) || user.banned || user.locked ||
      !user.emailAddresses?.some(e => e.id === user.primaryEmailAddressId && e.verification?.status === 'verified')) reject('VERIFIED_ACCOUNT_REQUIRED', 403);
  const meta = user.privateMetadata ?? {};
  const expires = typeof meta.proExpiresAt === 'string' ? Date.parse(meta.proExpiresAt) : NaN;
  // Never use membershipPreview, role, ownerMode or browser claims for discounts.
  return { userId: user.id, pro: meta.plan === 'pro' && expires > now,
    proUntil: meta.plan === 'pro' && expires > now ? new Date(expires).toISOString() : null };
}
// The first-purchase price switches by itself at LAUNCH_END (2027-03-01 00:00 JST): ¥7,980 → ¥9,800, $59 → $69.
// `priceAt` is when the price was fixed: the order's creation time. An order made before the switch keeps the
// amount it was created (and shown in PayPal) with until it expires, so what was shown is what is charged.
export function quote(kind, language, member, rights, now, priceAt = now) {
  if (!['initial', 'renewal'].includes(kind) || !['ja', 'en'].includes(language) || !Number.isFinite(now) ||
      !Number.isFinite(priceAt) || priceAt > now) reject('INVALID_PAYMENT_INPUT', 400);
  if (kind === 'initial' && rights.use) reject('ALREADY_PURCHASED');
  if (kind === 'renewal' && !rights.use) reject('INITIAL_PURCHASE_REQUIRED', 403);
  const priceClass = kind === 'initial' ? (priceAt < LAUNCH_END ? 'launch' : 'standard') : (member.pro ? 'pro' : 'free');
  const amounts = language === 'ja' ? { launch: 7980, standard: 9800, pro: 3980, free: 5980 }
    : { launch: 5900, standard: 6900, pro: 2900, free: 3900 };
  const minor = amounts[priceClass], currency = language === 'ja' ? 'JPY' : 'USD';
  return { kind, language, priceClass, minor, currency, value: currency === 'JPY' ? String(minor) : (minor / 100).toFixed(2), product: PRODUCT,
    sku: `${PRODUCT}:${kind}`, proUntil: priceClass === 'pro' ? member.proUntil : null };
}
export function sameQuote(a, b) {
  return ['kind','language','priceClass','minor','currency','product','sku'].every(k => a[k] === b[k]);
}
export function minorUnits(value, currency) {
  const pattern = currency === 'JPY' ? /^(0|[1-9]\d{0,8})(?:\.00)?$/ : /^(0|[1-9]\d{0,8})\.\d{2}$/;
  if (typeof value !== 'string' || !['JPY','USD'].includes(currency) || !pattern.test(value)) reject('PAYMENT_MISMATCH');
  return currency === 'JPY' ? Number(value) : Number(value.replace('.', ''));
}
export function verifyOrder(order, remote, merchantId, completed = false) {
  const q = order.quote;
  if (remote?.id !== order.paypal_id || remote.intent !== 'CAPTURE' || remote.purchase_units?.length !== 1) reject('PAYMENT_MISMATCH');
  const unit = remote.purchase_units[0];
  if (unit.reference_id !== order.id || unit.custom_id !== order.id || unit.invoice_id !== order.id ||
      unit.payee?.merchant_id !== merchantId || unit.amount?.currency_code !== q.currency ||
      minorUnits(unit.amount?.value, q.currency) !== q.minor || unit.items?.length !== 1 ||
      unit.items[0].sku !== q.sku || unit.items[0].quantity !== '1' ||
      unit.items[0].unit_amount?.currency_code !== q.currency || minorUnits(unit.items[0].unit_amount?.value, q.currency) !== q.minor) reject('PAYMENT_MISMATCH');
  if (!completed) { if (remote.status !== 'APPROVED') reject('PAYMENT_NOT_APPROVED'); return; }
  const captures = unit.payments?.captures;
  if (remote.status !== 'COMPLETED' || captures?.length !== 1) reject('PAYMENT_NOT_COMPLETED');
  const c = captures[0];
  if (c.status !== 'COMPLETED' || c.final_capture !== true || !/^[A-Z0-9]{8,32}$/.test(c.id ?? '') ||
      c.amount?.currency_code !== q.currency || minorUnits(c.amount?.value, q.currency) !== q.minor) reject('PAYMENT_MISMATCH');
  const paid = Date.parse(c.create_time), created = Date.parse(order.created_at);
  // A launch price needs an order created before the switch; the order's own expiry bounds how late it can be paid.
  const pricedAt = Number.isFinite(created) ? created : paid;
  if (!Number.isFinite(paid) || !order.capture_checked_at || paid < Date.parse(order.capture_checked_at) - 5000 ||
      paid > Date.parse(order.expires_at) || (q.priceClass === 'launch' && !(pricedAt < LAUNCH_END)) ||
      (q.priceClass === 'pro' && !(Date.parse(order.capture_pro_until) > paid))) reject('PAYMENT_REVIEW_REQUIRED');
  return { captureId: c.id, paidAt: new Date(paid).toISOString() };
}
export function addYear(date) {
  const d = new Date(date), month = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  if (d.getUTCMonth() !== month) d.setUTCDate(0);
  return d.toISOString();
}
