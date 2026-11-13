// Tech Phase recurring billing. Explicit Sandbox and Live environments.
// Explicit PRO configuration only. The owner approved sharing the Sandbox app
// credentials; payment tables, plans, webhook and entitlement writers stay separate.
const BASE = 'https://api-m.sandbox.paypal.com';
const environments = Object.freeze({
 sandbox: Object.freeze({base:BASE,approvalOrigin:'https://www.sandbox.paypal.com',certHosts:['api.sandbox.paypal.com','api-m.sandbox.paypal.com']}),
 live: Object.freeze({base:'https://api-m.paypal.com',approvalOrigin:'https://www.paypal.com',certHosts:['api.paypal.com','api-m.paypal.com']})
});
function environment(name) {
 if(name!=='sandbox'&&name!=='live')fail('BILLING_DISABLED');
 return environments[name];
}
export function liveReturnUrl(value) {
 let url;try{url=new URL(value);}catch{fail('BILLING_DISABLED');}
 if(url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/'||
 !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname)||/(?:^|\.)(?:localhost|test|invalid|example|vercel\.app)$/.test(url.hostname)||
 /^[0-9.]+$/.test(url.hostname)||value!==url.origin)fail('BILLING_DISABLED');
 return url.origin+'/research/account/billing';
}
export function liveConfig(env) {
 if(env.TECH_PHASE_PAYPAL_ENV!=='live')fail('BILLING_DISABLED');
 for(const key of ['CLIENT_ID','CLIENT_SECRET','WEBHOOK_ID'])if(typeof env[`TECH_PHASE_PAYPAL_LIVE_${key}`]!=='string'||!env[`TECH_PHASE_PAYPAL_LIVE_${key}`].trim())fail('BILLING_DISABLED');
 // Yearly plans are optional until configured: without them yearly checkout is refused, monthly is unaffected.
 const plans=Object.freeze({JPY:planId(env.TECH_PHASE_PAYPAL_LIVE_PLAN_JPY),USD:planId(env.TECH_PHASE_PAYPAL_LIVE_PLAN_USD),
  ...yearlyPlans(env.TECH_PHASE_PAYPAL_LIVE_PLAN_JPY_YEAR,env.TECH_PHASE_PAYPAL_LIVE_PLAN_USD_YEAR)});
 assertDistinctPlans(plans);
 return Object.freeze({environment:'live',base:environments.live.base,returnUrl:liveReturnUrl(env.TECH_PHASE_BILLING_LIVE_ORIGIN),clientId:env.TECH_PHASE_PAYPAL_LIVE_CLIENT_ID,secret:env.TECH_PHASE_PAYPAL_LIVE_CLIENT_SECRET,webhookId:env.TECH_PHASE_PAYPAL_LIVE_WEBHOOK_ID,plans});
}
export const RETURN_URL = 'https://tech-phase-lab-git-codex-research-preview-chehon7144-5412.vercel.app/research/account/billing';
export const OFFERS = Object.freeze({
  JPY: Object.freeze({ currency: 'JPY', minor: 2980, value: '2980', period: 'month' }),
  USD: Object.freeze({ currency: 'USD', minor: 2000, value: '20.00', period: 'month' }),
});
// Yearly = 10 months' price (17% off 12 months). Selected by currency + period on the server only.
export const YEARLY_OFFERS = Object.freeze({
  JPY: Object.freeze({ currency: 'JPY', minor: 29800, value: '29800', period: 'year' }),
  USD: Object.freeze({ currency: 'USD', minor: 20000, value: '200.00', period: 'year' }),
});
const fail = (code = 'PAYPAL_UNAVAILABLE') => { throw new Error(code); };
class ProviderSubscriptionNotFound extends Error {
  constructor() { super('PAYPAL_SUBSCRIPTION_NOT_FOUND'); }
}
const matches = (value, pattern) => typeof value === 'string' && pattern.test(value);
const yearlyPlans = (jpy, usd) => ({ ...(jpy === undefined || jpy === '' ? {} : { JPY_YEAR: planId(jpy) }),
  ...(usd === undefined || usd === '' ? {} : { USD_YEAR: planId(usd) }) });
const assertDistinctPlans = plans => { const ids = Object.values(plans); if (new Set(ids).size !== ids.length) fail('INVALID_PLAN'); };
/** Key of a plan in the plans map: JPY / USD (monthly), JPY_YEAR / USD_YEAR (yearly). */
export const planKey = (currency, period = 'month') => period === 'year' ? `${currency}_YEAR` : currency;
export const MONTHS = Object.freeze({ month: 1, year: 12 });
export const isPeriod = value => value === 'month' || value === 'year';
/** The period of a stored contract follows from its price; no extra column is needed. */
export function periodOfMinor(currency, minor) {
  if (OFFERS[currency]?.minor === minor) return 'month';
  if (YEARLY_OFFERS[currency]?.minor === minor) return 'year';
  fail('INVALID_OFFER');
}
const planId = value => matches(value, /^P-[A-Z0-9]{24}$/) ? value : fail('INVALID_PLAN');
const subscriptionId = value => matches(value, /^I-[A-Z0-9]{8,32}$/) ? value : fail('INVALID_SUBSCRIPTION');
const requestId = value => matches(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i) ? value : fail('INVALID_REQUEST_KEY');
export function sandboxConfig(env) {
  if (env.TECH_PHASE_PAYPAL_ENV !== 'sandbox') fail('BILLING_DISABLED');
  for (const key of ['CLIENT_ID', 'CLIENT_SECRET', 'WEBHOOK_ID']) {
    if (!env[`TECH_PHASE_PAYPAL_${key}`]?.trim()) fail('BILLING_DISABLED');
  }
  return Object.freeze({ environment: 'sandbox', returnUrl: RETURN_URL, base: BASE, clientId: env.TECH_PHASE_PAYPAL_CLIENT_ID,
    secret: env.TECH_PHASE_PAYPAL_CLIENT_SECRET, webhookId: env.TECH_PHASE_PAYPAL_WEBHOOK_ID,
    plans: Object.freeze({ JPY: planId(env.TECH_PHASE_PAYPAL_PLAN_JPY), USD: planId(env.TECH_PHASE_PAYPAL_PLAN_USD),
      ...yearlyPlans(env.TECH_PHASE_PAYPAL_PLAN_JPY_YEAR, env.TECH_PHASE_PAYPAL_PLAN_USD_YEAR) }) });
}
export function offer(currency, period = 'month') {
  if (currency !== 'JPY' && currency !== 'USD') fail('INVALID_OFFER');
  if (period === 'year') return YEARLY_OFFERS[currency];
  if (period !== 'month') fail('INVALID_OFFER');
  return OFFERS[currency];
}
function moneyMatches(money, expected) {
  if (money?.currency_code !== expected.currency || typeof money.value !== 'string') return false;
  const pattern = expected.currency === 'JPY' ? /^(0|[1-9]\d*)(\.0{1,2})?$/ : /^(0|[1-9]\d*)(\.\d{1,2})?$/;
  return pattern.test(money.value) && Number(money.value) === Number(expected.value);
}
export function assertPlan(plan, id, currency, period = 'month') {
  const q = offer(currency, period), cycles = plan?.billing_cycles, cycle = cycles?.[0];
  // No trials, setup charges, volume pricing or additional tax. Refuse drift before checkout.
  if (plan?.id !== id || plan.status !== 'ACTIVE' || plan.quantity_supported === true ||
      !Array.isArray(cycles) || cycles.length !== 1 || cycle.tenure_type !== 'REGULAR' ||
      cycle.sequence !== 1 || cycle.total_cycles !== 0 || cycle.frequency?.interval_unit !== (period === 'year' ? 'YEAR' : 'MONTH') ||
      cycle.frequency.interval_count !== 1 || !moneyMatches(cycle.pricing_scheme?.fixed_price, q) ||
      cycle.pricing_scheme?.pricing_model || cycle.pricing_scheme?.tiers?.length ||
      (plan.taxes && (!/^(0|0\.0+)$/.test(String(plan.taxes.percentage)) || plan.taxes.inclusive !== true)) ||
      (plan.payment_preferences?.setup_fee && !moneyMatches(plan.payment_preferences.setup_fee, { ...q, value: '0' })) ||
      plan.payment_preferences?.auto_bill_outstanding !== false) fail('PLAN_MISMATCH');
  return q;
}
export function approvalUrl(remote, mode = 'sandbox') {
  const profile=environment(mode);
  subscriptionId(remote?.id);
  const links = remote.links?.filter(link => link.rel === 'approve');
  if (!links || links.length !== 1) fail();
  let url; try { url = new URL(links[0].href); } catch { fail(); }
  if (url.origin !== profile.approvalOrigin || url.pathname !== '/webapps/billing/subscriptions' ||
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
  const mode=config.environment ?? 'sandbox', profile=environment(mode);
  const returnUrl=mode==='live'?liveReturnUrl(new URL(config.returnUrl).origin):RETURN_URL;
  if(config.base!==profile.base||config.returnUrl!==returnUrl||!config.clientId||!config.secret||!config.webhookId)fail('BILLING_DISABLED');
  const base=profile.base,clientId=config.clientId,secret=config.secret,webhookId=config.webhookId;
  const plans = { JPY: planId(config.plans?.JPY), USD: planId(config.plans?.USD), ...yearlyPlans(config.plans?.JPY_YEAR, config.plans?.USD_YEAR) };
  let token, expires = 0, tokenRequest;
  async function authorize() {
    if (token && Date.now() < expires) return token;
    if (!tokenRequest) tokenRequest = (async () => {
      const res = await fetcher(base + '/v1/oauth2/token', { method: 'POST', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(8000), headers: { Authorization: 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
      if (!res.ok) { await res.body?.cancel(); fail(); }
      const data = await json(res);
      if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 30) fail();
      token = data.access_token; expires = Date.now() + (data.expires_in - 30) * 1000;
      return token;
    })().finally(() => { tokenRequest = undefined; });
    return tokenRequest;
  }
  async function call(path, method = 'GET', body, key, subscriptionRead = false) {
    try {
      const credential = await authorize();
      const res = await fetcher(base + path, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', Prefer: 'return=representation',
          ...(key ? { 'PayPal-Request-Id': requestId(key) } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!res.ok) {
        if (res.status === 401 && token === credential) token = undefined;
        await res.body?.cancel();
        if (subscriptionRead && res.status === 404) throw new ProviderSubscriptionNotFound();
        fail();
      }
      if (res.status === 204) return null;
      return await json(res);
    } catch (error) {
      if (error instanceof ProviderSubscriptionNotFound) throw error;
      fail();
    } // Never expose provider error bodies, credentials or buyer details.
  }
  return {
    environment:mode,
    async create({ id, currency, period = 'month' }) {
      requestId(id); const q = offer(currency, period);
      const plan = plans[planKey(currency, period)];
      if (!plan) fail('INVALID_OFFER'); // The yearly plan is not configured on this deployment.
      assertPlan(await call(`/v1/billing/plans/${plan}`), plan, currency, period);
      const result = await call('/v1/billing/subscriptions', 'POST', { plan_id: plan, custom_id: id,
        plan: { billing_cycles: [{ sequence: 1, pricing_scheme: { fixed_price: { currency_code: q.currency, value: q.value } } }] },
        application_context: { brand_name: 'Tech Phase', shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW',
          return_url: `${returnUrl}?billing=${id}`, cancel_url: `${returnUrl}?billing=${id}&cancel=1` } }, id);
      if (!result || result.plan_id !== plan || result.custom_id !== id) fail();
      return { id: subscriptionId(result.id), approvalUrl: approvalUrl(result,mode) };
    },
    get: id => call(`/v1/billing/subscriptions/${subscriptionId(id)}`, 'GET', undefined, undefined, true),
    getDetails: id => call(`/v1/billing/subscriptions/${subscriptionId(id)}?fields=plan`),
    cancel: id => call(`/v1/billing/subscriptions/${subscriptionId(id)}/cancel`, 'POST', { reason: 'Cancelled by the subscriber' }),
    async transactions(id, start, end) {
      subscriptionId(id);
      const from = Date.parse(start), to = Date.parse(end);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 31 * 86400000) fail('INVALID_PERIOD');
      const params = new URLSearchParams({ start_time: new Date(from).toISOString(), end_time: new Date(to).toISOString() });
      return call(`/v1/billing/subscriptions/${id}/transactions?${params}`);
    },
    async verify(headers, event) {
      const data = { webhook_id: webhookId, webhook_event: event };
      for (const [key, header] of Object.entries({ transmission_id: 'paypal-transmission-id', transmission_time: 'paypal-transmission-time',
        cert_url: 'paypal-cert-url', auth_algo: 'paypal-auth-algo', transmission_sig: 'paypal-transmission-sig' })) {
        data[key] = headers.get(header); if (!data[key] || data[key].length > 4096) return false;
      }
      let cert; try { cert = new URL(data.cert_url); } catch { return false; }
      if (cert.protocol !== 'https:' || !profile.certHosts.includes(cert.hostname) ||
          cert.port || cert.username || cert.password || cert.search || cert.hash || !/^\/v1\/notifications\/certs\/[A-Za-z0-9-]+$/.test(cert.pathname)) return false;
      return (await call('/v1/notifications/verify-webhook-signature', 'POST', data))?.verification_status === 'SUCCESS';
    },
  };
}
