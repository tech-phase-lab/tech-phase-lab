/** Live configuration self-check: booleans only, never a key, URL or any part of a secret.
 * paymentClerkKeyLive tells whether RESOLUTE_PAYMENT_CLERK_SECRET_KEY belongs to a production Clerk instance
 * (Clerk production secret keys start with `sk_live_`; development ones with `sk_test_`). */
export function liveConfigSelfCheck(env) {
  const key = env.RESOLUTE_PAYMENT_CLERK_SECRET_KEY;
  return { paymentClerkKeySet: typeof key === 'string' && key.length > 0,
    paymentClerkKeyLive: typeof key === 'string' && key.startsWith('sk_live_') };
}
