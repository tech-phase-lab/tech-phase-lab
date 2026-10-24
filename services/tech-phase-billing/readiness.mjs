import { sandboxConfig } from './paypal.mjs';
import { sandboxDatabaseConfig } from './database-config.mjs';

// Configuration inspection only: no provider requests, DB connection or writes.
// Only explicit PRO names are accepted; RESOLUTE settings are never fallbacks.
export function sandboxReadiness(env) {
  const required = [
    'TECH_PHASE_PAYPAL_ENV', 'TECH_PHASE_PAYPAL_CLIENT_ID',
    'TECH_PHASE_PAYPAL_CLIENT_SECRET', 'TECH_PHASE_PAYPAL_WEBHOOK_ID',
    'TECH_PHASE_PAYPAL_PLAN_JPY', 'TECH_PHASE_PAYPAL_PLAN_USD',
    'TECH_PHASE_BILLING_SANDBOX_DATABASE_URL',
  ];
  const missing = required.filter(key => typeof env[key] !== 'string' || !env[key].trim());
  const problems = [];
  if (env.VERCEL_ENV !== 'preview') problems.push('preview-required');
  if (env.TECH_PHASE_PAYPAL_ENV && env.TECH_PHASE_PAYPAL_ENV !== 'sandbox') problems.push('sandbox-required');
  if (!missing.some(key => key.startsWith('TECH_PHASE_PAYPAL_'))) {
    try {
      const config = sandboxConfig(env);
      if (config.plans.JPY === config.plans.USD) problems.push('distinct-currency-plans-required');
    } catch { problems.push('invalid-paypal-config'); }
  }
  if (!missing.includes('TECH_PHASE_BILLING_SANDBOX_DATABASE_URL')) {
    try {
      const config = sandboxDatabaseConfig(env);
      // This handler runs on Vercel, outside Railway's private network.
      if (env.TECH_PHASE_BILLING_RUNTIME !== 'railway-sandbox' && new URL(config.connectionString).hostname.endsWith('.railway.internal')) problems.push('database-network-unreachable');
    } catch { problems.push('invalid-database-config'); }
  }
  return {
    environment: 'sandbox',
    enabled: env.VERCEL_ENV === 'preview' && env.TECH_PHASE_PAYPAL_ENV === 'sandbox' && env.TECH_PHASE_BILLING_SANDBOX_ENABLED === 'true',
    configurationReady: missing.length === 0 && problems.length === 0,
    connectionVerified: false,
    missing, problems,
  };
}
