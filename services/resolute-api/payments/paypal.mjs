import { PaymentError, reject } from './policy.mjs';
import { paypalEnvironment, paypalEnvironmentForBase, liveReturnUrl } from './paypal-environments.mjs';
export const SANDBOX_RETURN = 'https://tech-phase-lab-git-codex-research-preview-chehon7144-5412.vercel.app/resolute/checkout';
// The buyer is always sent to PayPal's standard approval page for this order (checkoutnow?token=<order>), built from the
// verified order id. PayPal's own link must be on PayPal's approval host and name this order; its exact shape (path, extra
// parameters, which can differ for orders that save a payment method) no longer fails the purchase (live, Nov 24).
export function approvalUrl(remote, orderId, environment = 'sandbox') {
  const selected=paypalEnvironment(environment);
  const link = remote?.links?.find(link => ['approve','payer-action'].includes(link.rel));
  if (!link) return null;
  let url; try { url = new URL(link.href); } catch { paypalFailure({stage:'approval-link',reason:'unparsable'}); }
  const token=url.searchParams.get('token');
  if (remote.id !== orderId || !/^[A-Z0-9]{8,32}$/.test(orderId ?? '')) paypalFailure({stage:'approval-link',reason:'order-id'});
  if (url.origin !== selected.approvalOrigin || url.username || url.password) paypalFailure({stage:'approval-link',reason:'origin'});
  if (token !== null && token !== orderId) paypalFailure({stage:'approval-link',reason:'token'});
  return `${selected.approvalOrigin}/checkoutnow?token=${orderId}`;
}
// Only short PayPal codes (error name, issue, debug id) are kept for the service log: never bodies, tokens or payer data.
const code = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : undefined;
export function paypalFailure(detail, status = 503, error = 'PAYPAL_UNAVAILABLE') {
  const e = new PaymentError(error, status); e.detail = detail; throw e;
}
async function failureDetail(res, stage) {
  let body = null;
  try { const text = await res.text(); if (text.length <= 16384) body = JSON.parse(text); } catch { /* not JSON */ }
  return { stage, status: res.status, name: code(body?.name) ?? code(body?.error), issue: code(body?.details?.[0]?.issue), debugId: code(body?.debug_id) };
}
export function paypalConfig(env) {
  // Live charging intentionally unavailable until Sandbox acceptance and rollout.
  if (env.RESOLUTE_PAYPAL_ENV !== 'sandbox' || !env.RESOLUTE_PAYPAL_CLIENT_ID || !env.RESOLUTE_PAYPAL_CLIENT_SECRET ||
      !/^[A-Z0-9]{8,32}$/.test(env.RESOLUTE_PAYPAL_MERCHANT_ID ?? '') || !env.RESOLUTE_PAYPAL_WEBHOOK_ID) reject('PAYMENT_UNAVAILABLE', 503);
  return { base: 'https://api-m.sandbox.paypal.com', clientId: env.RESOLUTE_PAYPAL_CLIENT_ID,
    secret: env.RESOLUTE_PAYPAL_CLIENT_SECRET, merchantId: env.RESOLUTE_PAYPAL_MERCHANT_ID,
    webhookId: env.RESOLUTE_PAYPAL_WEBHOOK_ID };
}
// Dedicated live credentials; never fall back to the Sandbox variables.
// This is preparation only: the public runtime does not call this factory yet.
export function livePaypalConfig(env) {
  if (env.RESOLUTE_PAYPAL_LIVE_ENABLED !== 'true' || !env.RESOLUTE_PAYPAL_LIVE_CLIENT_ID ||
      !env.RESOLUTE_PAYPAL_LIVE_CLIENT_SECRET || !/^[A-Z0-9]{8,32}$/.test(env.RESOLUTE_PAYPAL_LIVE_MERCHANT_ID ?? '') ||
      !env.RESOLUTE_PAYPAL_LIVE_WEBHOOK_ID) reject('PAYMENT_UNAVAILABLE',503);
  return {base:paypalEnvironment('live').base, clientId:env.RESOLUTE_PAYPAL_LIVE_CLIENT_ID,
    secret:env.RESOLUTE_PAYPAL_LIVE_CLIENT_SECRET, merchantId:env.RESOLUTE_PAYPAL_LIVE_MERCHANT_ID,
    webhookId:env.RESOLUTE_PAYPAL_LIVE_WEBHOOK_ID, returnUrl:liveReturnUrl(env.RESOLUTE_LIVE_SITE_ORIGIN)};
}
export async function readJson(response, limit = 131072) {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) reject('JSON_REQUIRED', 415);
  const reader = response.body?.getReader();
  if (!reader) reject('INVALID_PAYMENT_INPUT', 400);
  let size = 0; const parts = [];
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > limit) reject('BODY_TOO_LARGE', 413); parts.push(value); }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch (error) { await reader.cancel(); if (error instanceof PaymentError) throw error; reject('INVALID_PAYMENT_INPUT', 400); }
}
export function createPaypal(config, fetcher = fetch) {
  const environment=paypalEnvironmentForBase(config.base), selected=paypalEnvironment(environment);
  const returnUrl=environment === 'sandbox' ? SANDBOX_RETURN : (()=>{
    let url; try { url=new URL(config.returnUrl); } catch { reject('PAYMENT_UNAVAILABLE',503); }
    if (config.returnUrl !== liveReturnUrl(url.origin)) reject('PAYMENT_UNAVAILABLE',503);
    return config.returnUrl;
  })();
  let cached, expires = 0;
  // definite: a 4xx answer (other than auth, idempotency-in-progress and rate limits) is PayPal's final refusal of a
  // merchant-initiated charge — nothing was captured — so the caller may record a decline instead of an unknown result.
  async function call(path, method = 'GET', body, key, definite = false) {
    const stage = `${method} ${path.replace(/[A-Za-z0-9_-]{8,64}(?=\/|$)/g, m => /^(v\d|orders|checkout|payments|captures|vault|notifications|oauth2|token|payment-tokens|capture|verify-webhook-signature)$/.test(m) ? m : ':id')}`;
    try {
      if (!cached || Date.now() >= expires) {
        const res = await fetcher(`${config.base}/v1/oauth2/token`, { method: 'POST', redirect: 'error', cache: 'no-store',
          signal: AbortSignal.timeout(8000), headers: { Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.secret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
        if (!res.ok) paypalFailure(await failureDetail(res, 'POST /v1/oauth2/token'));
        const data = await readJson(res);
        if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in < 60) reject('PAYPAL_UNAVAILABLE', 503);
        cached = data.access_token; expires = Date.now() + (data.expires_in - 30) * 1000;
      }
      const res = await fetcher(config.base + path, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${cached}`, 'Content-Type': 'application/json', Prefer: 'return=representation',
          ...(key ? { 'PayPal-Request-Id': key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!res.ok) { if (res.status === 401) cached = undefined;
        const detail = await failureDetail(res, stage);
        if (definite && res.status >= 400 && res.status < 500 && ![401, 403, 408, 409, 429].includes(res.status)) paypalFailure(detail, 402, 'PAYPAL_DECLINED');
        paypalFailure(detail); }
      return await readJson(res);
    } catch (error) { // Never expose response bodies, tokens or payment PII: only the short codes in detail reach the log.
      if (error instanceof PaymentError && error.code === 'PAYPAL_DECLINED') throw error;
      paypalFailure(error instanceof PaymentError && error.detail ? error.detail
        : { stage, reason: error instanceof PaymentError ? error.code : error?.name === 'TimeoutError' ? 'timeout' : 'network' });
    }
  }
  const id = value => { if (!/^[A-Z0-9]{8,32}$/.test(value ?? '')) reject('INVALID_PAYMENT_INPUT', 400); return value; };
  const token = value => { if (!/^[A-Za-z0-9_-]{1,64}$/.test(value ?? '')) reject('INVALID_PAYMENT_INPUT', 400); return value; };
  // The same purchase unit for first purchases and renewals, so verifyOrder checks both the same way.
  const unit = (order, q, amount) => ({ reference_id: order.id,
        custom_id: order.id, invoice_id: order.id, payee: { merchant_id: config.merchantId },
        amount: { ...amount, breakdown: { item_total: amount } },
        items: [{ name: q.kind === 'initial' ? 'RESOLUTE' : 'RESOLUTE annual renewal', sku: q.sku,
          quantity: '1', category: 'DIGITAL_GOODS', unit_amount: amount }] });
  return {
    async create(order) {
      const q = order.quote, amount = { currency_code: q.currency, value: q.value };
      // Automatic renewal (flag on, signed-in first purchase only): ask PayPal to save the buyer's PayPal for later
      // merchant-initiated renewals. PayPal shows its own consent for that; the vault id comes back with the capture.
      // https://developer.paypal.com/docs/checkout/save-payment-methods/during-purchase/orders-api/paypal/
      const vault = order.auto_renewal_offered === true && q.kind === 'initial'
        ? { attributes: { vault: { store_in_vault: 'ON_SUCCESS', usage_type: 'MERCHANT', customer_type: 'CONSUMER' } } } : {};
      // A separate PayPal-Request-Id for the saving request, so the same order can be sent again without it.
      const key = order.auto_renewal_offered === true ? `${order.id}:vault` : order.id;
      return call('/v2/checkout/orders', 'POST', { intent: 'CAPTURE', payment_source: { paypal: { ...vault, experience_context: {
        // Opens PayPal on its 「銀行｜カード」 page (card/bank without a PayPal login) instead of the login page.
        // Checked in Sandbox with a JP buyer (owner, Nov 2026).
        shipping_preference: 'NO_SHIPPING', user_action: 'CONTINUE', landing_page: 'GUEST_CHECKOUT',
        return_url: `${returnUrl}?order=${order.id}&lang=${q.language}${order.guest_id ? "&guest=1" : ""}`,
        cancel_url: `${returnUrl}?order=${order.id}&lang=${q.language}${order.guest_id ? "&guest=1" : ""}&cancel=1`
      } } }, purchase_units: [unit(order, q, amount)] }, key);
    },
    // Merchant-initiated renewal with the saved PayPal (payer not present). PayPal-Request-Id is the order's own
    // capture key, so a retry after a lost answer returns the same PayPal order instead of charging twice.
    // https://developer.paypal.com/docs/checkout/save-payment-methods/purchase-later/payment-tokens-api/paypal/
    async charge(order, vaultId) {
      const q = order.quote, amount = { currency_code: q.currency, value: q.value };
      if (q.kind !== 'renewal') reject('INVALID_PAYMENT_INPUT', 400);
      return call('/v2/checkout/orders', 'POST', { intent: 'CAPTURE', payment_source: { paypal: { vault_id: token(vaultId) } },
        purchase_units: [unit(order, q, amount)] }, order.capture_key, true);
    },
    vaultToken: tokenId => call(`/v3/vault/payment-tokens/${token(tokenId)}`),
    approval: async orderId => approvalUrl(await call(`/v2/checkout/orders/${id(orderId)}`),orderId,environment),
    get: orderId => call(`/v2/checkout/orders/${id(orderId)}`),
    capture: order => call(`/v2/checkout/orders/${id(order.paypal_id)}/capture`, 'POST', {}, order.capture_key),
    captureDetails: captureId => call(`/v2/payments/captures/${id(captureId)}`),
    async verify(headers, event) {
      const fields = { transmission_id: 'paypal-transmission-id', transmission_time: 'paypal-transmission-time',
        cert_url: 'paypal-cert-url', auth_algo: 'paypal-auth-algo', transmission_sig: 'paypal-transmission-sig' };
      const data = { webhook_id: config.webhookId, webhook_event: event };
      for (const [key, header] of Object.entries(fields)) {
        data[key] = headers.get(header); if (!data[key] || data[key].length > 4096) return false;
      }
      let cert; try { cert = new URL(data.cert_url); } catch { return false; }
      if (cert.protocol !== 'https:' || !selected.apiHosts.includes(cert.hostname) ||
          cert.port || cert.username || cert.password || cert.search || cert.hash || !cert.pathname.startsWith('/v1/notifications/certs/')) return false;
      // Only PayPal receives the certificate URL. Never fetch a caller-supplied URL.
      const result = await call('/v1/notifications/verify-webhook-signature', 'POST', data);
      return result.verification_status === 'SUCCESS';
    },
  };
}
