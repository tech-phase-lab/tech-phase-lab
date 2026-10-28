import { liveConfig, liveReturnUrl } from './paypal.mjs';
import { liveDatabaseConfig } from './database-config.mjs';
import { liveTransportConfig } from './live-transport.mjs';

/** Offline preparation only. Never constructs a runtime, connects, or enables billing. */
export function livePreflight(env, role) {
  if (!['web', 'api', 'recovery'].includes(role)) throw Error('INVALID_PREFLIGHT_ROLE');
  const common = ['TECH_PHASE_PAYPAL_ENV', 'TECH_PHASE_BILLING_LIVE_ORIGIN'];
  const backend = ['TECH_PHASE_BILLING_RUNTIME', 'TECH_PHASE_BILLING_LIVE_BRANCH', 'RAILWAY_GIT_BRANCH',
    'TECH_PHASE_BILLING_LIVE_DATABASE_URL', ...['CLIENT_ID', 'CLIENT_SECRET', 'WEBHOOK_ID', 'PLAN_JPY', 'PLAN_USD'].map(k => `TECH_PHASE_PAYPAL_LIVE_${k}`)];
  const required = [...common, ...(role === 'web'
    ? ['VERCEL_ENV', 'TECH_PHASE_BILLING_LIVE_SERVICE_URL', 'TECH_PHASE_BILLING_LIVE_SERVICE_TOKEN']
    : [...backend, ...(role === 'api' ? ['TECH_PHASE_BILLING_LIVE_SERVICE_TOKEN'] : [])])];
  const missing = required.filter(key => typeof env[key] !== 'string' || !env[key].trim());
  const problems = [];
  if (env.TECH_PHASE_PAYPAL_ENV !== 'live') problems.push('live-environment-required');
  try { liveReturnUrl(env.TECH_PHASE_BILLING_LIVE_ORIGIN); } catch { problems.push('invalid-live-origin'); }
  if (role === 'web') {
    if (env.VERCEL_ENV !== 'production') problems.push('production-web-required');
    try { liveTransportConfig(env); } catch { problems.push('invalid-live-transport'); }
  } else {
    if (env.TECH_PHASE_BILLING_RUNTIME !== 'railway-live') problems.push('live-runtime-required');
    if (!env.TECH_PHASE_BILLING_LIVE_BRANCH || env.TECH_PHASE_BILLING_LIVE_BRANCH !== env.RAILWAY_GIT_BRANCH) problems.push('deployment-branch-mismatch');
    try { liveConfig(env); } catch { problems.push('invalid-live-paypal-config'); }
    try { liveDatabaseConfig(env); } catch { problems.push('invalid-live-database-config'); }
    if (role === 'api' && !/^[A-Za-z0-9_-]{43,128}$/.test(env.TECH_PHASE_BILLING_LIVE_SERVICE_TOKEN ?? '')) problems.push('invalid-service-token');
    if (role === 'recovery' && env.TECH_PHASE_BILLING_LIVE_RECOVERY_LIMIT !== undefined
      && !/^(?:[1-9]|1[0-9]|2[0-5])$/.test(env.TECH_PHASE_BILLING_LIVE_RECOVERY_LIMIT)) problems.push('invalid-recovery-limit');
  }
  const names = role === 'recovery' ? ['RECOVERY_ENABLED']
    : ['ENABLED', 'SALES_ENABLED', 'ENTITLEMENTS_ENABLED', ...(role === 'api' ? ['WEBHOOK_ENABLED'] : [])];
  const flags = names.map(name => `TECH_PHASE_BILLING_LIVE_${name}`);
  const activeFlags = flags.filter(key => env[key] === 'true');
  for (const key of flags) if (env[key] !== undefined && !['true', 'false'].includes(env[key])) problems.push(`invalid-flag:${key}`);
  return { role, configurationReady: missing.length === 0 && problems.length === 0,
    preparationSafe: activeFlags.length === 0, connectionVerified: false, launchReady: false,
    missing, problems, activeFlags };
}
