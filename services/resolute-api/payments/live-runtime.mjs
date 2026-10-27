import { authenticateGuest } from './guest.mjs';
import { authenticate } from '../auth.mjs';
import { OWNER_ACCOUNT_ID } from '../../../lib/membership/entitlements.ts';
import { createLivePaymentServices } from './live-services.mjs';
import { paymentHttp } from './http.mjs';

// Separate server-owned namespace: no request field can select the environment.
export function livePaymentRuntime(env, authConfig, createServices = createLivePaymentServices) {
  let handler;
  return async request => {
    const path = new URL(request.url).pathname;
    if (path !== '/internal/v1/live-payments' && !path.startsWith('/internal/v1/live-payments/') && path !== '/webhooks/paypal-live') return null;
    const unavailable = error => Response.json({error}, {status:503, headers:{'Cache-Control':'private, no-store'}});
    if (env.RESOLUTE_PAYPAL_LIVE_ENABLED !== 'true') return unavailable('PAYMENT_DISABLED');
    // Readback and verified adverse events stay available after sales are stopped.
    try {
      if (!handler) {
        const services = createServices(env);
        handler = paymentHttp({ ...services, environment:'live', enabled:true,
          authenticate:headers => authenticate(headers, authConfig),
          authenticateGuest:headers => authenticateGuest(headers,authConfig),
          guestEnabled:()=>env.RESOLUTE_GUEST_CHECKOUT_ENABLED === 'true',
          allowedUsers:null, auditUsers:[OWNER_ACCOUNT_ID] });
      }
      return await handler(request);
    } catch { return unavailable('PAYMENT_UNAVAILABLE'); }
  };
}
