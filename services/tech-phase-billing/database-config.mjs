// Provisioning is explicit. Never consume DATABASE_URL or RESOLUTE payment URLs.
export function sandboxDatabaseConfig(env) {
  if (env.TECH_PHASE_PAYPAL_ENV !== 'sandbox' || !env.TECH_PHASE_BILLING_SANDBOX_DATABASE_URL) throw Error('BILLING_DISABLED');
  return databaseConfig(env.TECH_PHASE_BILLING_SANDBOX_DATABASE_URL, 'sandbox');
}
export function liveDatabaseConfig(env) {
  if(env.TECH_PHASE_PAYPAL_ENV !== 'live' || !env.TECH_PHASE_BILLING_LIVE_DATABASE_URL) throw Error('BILLING_DISABLED');
  return databaseConfig(env.TECH_PHASE_BILLING_LIVE_DATABASE_URL, 'live');
}
function databaseConfig(value, mode) {
  const database = `tech_phase_billing_${mode}`;
  let url; try { url = new URL(value); } catch { throw Error('INVALID_BILLING_DATABASE'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hash ||
      decodeURIComponent(url.pathname) !== `/${database}` ||
      decodeURIComponent(url.username) !== `${database}_writer` || !url.password ||
      [...url.searchParams].some(([key, value]) => key !== 'sslmode' || value !== 'verify-full')) throw Error('INVALID_BILLING_DATABASE');
  const privateNetwork = mode === 'sandbox' && url.hostname === 'postgres.railway.internal';
  const tls = !privateNetwork || url.searchParams.has('sslmode');
  url.search = '';
  return { connectionString: url.toString(), ssl: tls ? { rejectUnauthorized: true } : false,
    max: 2, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000, statement_timeout: 5000,
    query_timeout: 6000, application_name: `tech-phase-billing-${mode}`, allowExitOnIdle: true };
}
