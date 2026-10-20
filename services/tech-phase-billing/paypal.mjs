// Tech Phase recurring billing. This adapter is deliberately Sandbox-only.
// Explicit PRO configuration only. The owner approved sharing the Sandbox app
// credentials; payment tables, plans, webhook and entitlement writers stay separate.
const BASE = 'https://api-m.sandbox.paypal.com';
export const RETURN_URL = 'https://tech-phase-lab-git-codex-research-preview-chehon7144-5412.vercel.app/research/account/billing';
export const OFFERS = Object.freeze({
  JPY: Object.freeze({ currency: 'JPY', minor: 2980, value: '2980' }),
  USD: Object.freeze({ currency: 'USD', minor: 2000, value: '20.00' }),
});
const fail = (code = 'PAYPAL_UNAVAILABLE') => { throw new Error(code); };
const matches = (value, pattern) => typeof value === 'string' && pattern.test(value);
const planId = value => matches(value, /^P-[A-Z0-9]{24}$/) ? value : fail('INVALID_PLAN');
const subscriptionId = value => matches(value, /^I-[A-Z0-9]{8,32}$/) ? value : fail('INVALID_SUBSCRIPTION');
const requestId = value => matches(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i) ? value : fail('INVALID_REQUEST_KEY');
export function sandboxConfig(env) {
  if (env.TECH_PHASE_PAYPAL_ENV !== 'sandbox') fail('BILLING_DISABLED');
  for (const key of ['CLIENT_ID', 'CLIENT_SECRET', 'WEBHOOK_ID']) {
    if (!env[`TECH_PHASE_PAYPAL_${key}`]?.trim()) fail('BILLING_DISABLED');
  }
  return Object.freeze({ base: BASE, clientId: env.TECH_PHASE_PAYPAL_CLIENT_ID,
    secret: env.TECH_PHASE_PAYPAL_CLIENT_SECRET, webhookId: env.TECH_PHASE_PAYPAL_WEBHOOK_ID,
    plans: Object.freeze({ JPY: planId(env.TECH_PHASE_PAYPAL_PLAN_JPY), USD: planId(env.TECH_PHASE_PAYPAL_PLAN_USD) }) });
}
export function offer(currency) {
  if (currency !== 'JPY' && currency !== 'USD') fail('INVALID_OFFER');
  return OFFERS[currency];
}
function moneyMatches(money, expected) {
  if (money?.currency_code !== expected.currency || typeof money.value !== 'string') return false;
  const pattern = expected.currency === 'JPY' ? /^(0|[1-9]\d*)(\.0{1,2})?$/ : /^(0|[1-9]\d*)(\.\d{1,2})?$/;
  return pattern.test(money.value) && Number(money.value) === Number(expected.value);
}
export function assertPlan(plan, id, currency) {
  const q = offer(currency), cycles = plan?.billing_cycles, cycle = cycles?.[0];
  // No trials, setup charges, volume pricing or additional tax. Refuse drift before checkout.
  if (plan?.id !== id || plan.status !== 'ACTIVE' || plan.quantity_supported === true ||
      !Array.isArray(cycles) || cycles.length !== 1 || cycle.tenure_type !== 'REGULAR' ||
      cycle.sequence !== 1 || cycle.total_cycles !== 0 || cycle.frequency?.interval_unit !== 'MONTH' ||
      cycle.frequency.interval_count !== 1 || !moneyMatches(cycle.pricing_scheme?.fixed_price, q) ||
      cycle.pricing_scheme?.pricing_model || cycle.pricing_scheme?.tiers?.length ||
      (plan.taxes && (!/^(0|0\.0+)$/.test(String(plan.taxes.percentage)) || plan.taxes.inclusive !== true)) ||
      (plan.payment_preferences?.setup_fee && !moneyMatches(plan.payment_preferences.setup_fee, { ...q, value: '0' })) ||
      plan.payment_preferences?.auto_bill_outstanding !== false) fail('PLAN_MISMATCH');
  return q;
}
export function approvalUrl(remote) {
  subscriptionId(remote?.id);
  const links = remote.links?.filter(link => link.rel === 'approve');
  if (!links || links.length !== 1) fail();
  let url; try { url = new URL(links[0].href); } catch { fail(); }
  if (url.origin !== 'https://www.sandbox.paypal.com' || url.pathname !== '/webapps/billing/subscriptions' ||
      url.username || url.password || url.hash || !matches(url.searchParams.get('ba_token'), /^BA-[A-Z0-9]{8,64}$/) ||
      [...url.searchParams].length !== 1) fail();
  return url.href;
}
async function json(response) {
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    await response.body?.cancel().catch(() => {});
    fail();
  }
  const reader = response.body?.getReader();
  if (!reader) fail();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 262144) fail(); chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { await reader.cancel().catch(() => {}); fail(); }
  finally { reader.releaseLock(); }
}
export function createPaypal(config, fetcher = fetch) {
  if (config.base !== BASE || !config.clientId || !config.secret || !config.webhookId) fail('BILLING_DISABLED');
  const plans = { JPY: planId(config.plans?.JPY), USD: planId(config.plans?.USD) };
  let token, expires = 0, tokenRequest;
  async function authorize() {
    if (token && Date.now() < expires) return token;
    if (!tokenRequest) tokenRequest = (async () => {
      const res = await fetcher(BASE + '/v1/oauth2/token', { method: 'POST', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(8000), headers: { Authorization: 'Basic ' + Buffer.from(`${config.clientId}:${config.secret}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
      if (!res.ok) { await res.body?.cancel(); fail(); }
      const data = await json(res);
      if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 30) fail();
      token = data.access_token; expires = Date.now() + (data.expires_in - 30) * 1000;
      return token;
    })().finally(() => { tokenRequest = undefined; });
    return tokenRequest;
  }
  async function call(path, method = 'GET', body, key) {
    try {
      const credential = await authorize();
      const res = await fetcher(BASE + path, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', Prefer: 'return=representation',
          ...(key ? { 'PayPal-Request-Id': requestId(key) } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!res.ok) { if (res.status === 401 && token === credential) token = undefined; await res.body?.cancel(); fail(); }
      if (res.status === 204) return null;
      return await json(res);
    } catch { fail(); } // Never expose provider error bodies, credentials or buyer details.
  }
  return {
    async create({ id, currency }) {
      requestId(id); const q = offer(currency);
      assertPlan(await call(`/v1/billing/plans/${plans[currency]}`), plans[currency], currency);
      const result = await call('/v1/billing/subscriptions', 'POST', { plan_id: plans[currency], custom_id: id,
        plan: { billing_cycles: [{ sequence: 1, pricing_scheme: { fixed_price: { currency_code: q.currency, value: q.value } } }] },
        application_context: { brand_name: 'Tech Phase', shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW',
          return_url: `${RETURN_URL}?billing=${id}`, cancel_url: `${RETURN_URL}?billing=${id}&cancel=1` } }, id);
      if (!result || result.plan_id !== plans[currency] || result.custom_id !== id) fail();
      return { id: subscriptionId(result.id), approvalUrl: approvalUrl(result) };
    },
    get: id => call(`/v1/billing/subscriptions/${subscriptionId(id)}`),
    cancel: id => call(`/v1/billing/subscriptions/${subscriptionId(id)}/cancel`, 'POST', { reason: 'Cancelled by the subscriber' }),
    async transactions(id, start, end) {
      subscriptionId(id);
      const from = Date.parse(start), to = Date.parse(end);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 31 * 86400000) fail('INVALID_PERIOD');
      const params = new URLSearchParams({ start_time: new Date(from).toISOString(), end_time: new Date(to).toISOString() });
      return call(`/v1/billing/subscriptions/${id}/transactions?${params}`);
    },
    async verify(headers, event) {
      const data = { webhook_id: config.webhookId, webhook_event: event };
      for (const [key, header] of Object.entries({ transmission_id: 'paypal-transmission-id', transmission_time: 'paypal-transmission-time',
        cert_url: 'paypal-cert-url', auth_algo: 'paypal-auth-algo', transmission_sig: 'paypal-transmission-sig' })) {
        data[key] = headers.get(header); if (!data[key] || data[key].length > 4096) return false;
      }
      let cert; try { cert = new URL(data.cert_url); } catch { return false; }
      if (cert.protocol !== 'https:' || !['api.sandbox.paypal.com', 'api-m.sandbox.paypal.com'].includes(cert.hostname) ||
          cert.port || cert.username || cert.password || cert.search || cert.hash || !/^\/v1\/notifications\/certs\/[A-Za-z0-9-]+$/.test(cert.pathname)) return false;
      return (await call('/v1/notifications/verify-webhook-signature', 'POST', data))?.verification_status === 'SUCCESS';
    },
  };
}
