/** Explicit one-time operator job (step 6b). Never exposed through HTTP, API startup or any worker.
 * For ONE synthetic Clerk id (user_acceptance...) in the production `resolute` database it runs the
 * same store code the API uses, through the same least-privilege roles:
 *   1. plan save (revision 1) and notification settings with both choices ON (revision 1)
 *   2. plan delete (revision 2)
 *   3. both notification choices OFF (revision 2)
 * so the protection gateway receives three events: delete, alerts_off, morning_off.
 * The only deviation from the API path: the synthetic id has no entitlement row and the writer roles cannot
 * create one, so the single legacy entitlement SELECT for that id is answered locally. Nothing else is bypassed.
 * Customer saving flags are never read as enabled: the job refuses to run when either is 'true'.
 * It never prints URLs, tokens, keys or the user id. Any error stops it; there is no retry, no schema change and no key creation.
 */
import pg from 'pg';
import {pathToFileURL} from 'node:url';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {createPlanStore} from '../../lib/resolute/plan-database.ts';
import {createNotificationStore} from '../../lib/resolute/notification-database.ts';
import {protectionGatewayConfig,protectionGatewayObjects} from '../../lib/resolute/protection-runtime.ts';
import {createProtectionPublisher} from '../../lib/resolute/protection-ledger.ts';
import {createProtectionBarrier} from '../../lib/resolute/protection-outbox.ts';
import {emptyPlanAnswers} from '../../lib/resolute/plan-answers.ts';

export const USER_PATTERN = /^user_acceptance[A-Za-z0-9]{1,100}$/;
const TOTAL_TIMEOUT_MS = 90000;
class Stop extends Error { constructor(stage) { super(stage); this.stage = stage; } }

const PLAN = {schemaVersion: 1, answersVersion: 1, answers: emptyPlanAnswers(), fx: {thresholdYen: null, usdJpy: null, note: 'synthetic'},
  currency: 'JPY', monthlyLivingCost: 250000, savingsMonths: 12, reserveMonths: 6, nearTermExpense: 0, financialAssets: 10000000,
  investedAmount: 3000000, investable: 8500000, tolerancePct: 20, toleranceDrop: 600000, perStockCapPct: 20, buyMode: 'steps',
  buyLines: [{dropPct: 10, amount: 100000}, {dropPct: 20, amount: 100000}], buyBudgetPct: 10, allocation: 'equal',
  noBuyConditions: [], haltConditions: [], ruleType: 'undecided'};
const ON = {deliveryHourJst: 7, alertsEnabled: true, morningEnabled: true, watchItems: [{symbol: 'MU', referencePrice: 100}], surgeCapPct: null};
const OFF = {...ON, alertsEnabled: false, morningEnabled: false};

function scopedConfig(value, role) {
  let config;
  try { config = resoluteDatabaseConfig(value); } catch { throw new Stop('config'); }
  const url = new URL(config.connectionString);
  if (url.hostname !== 'postgres.railway.internal' || decodeURIComponent(url.pathname) !== '/resolute' || url.username !== role) throw new Stop('config');
  return config;
}
/** Answers only the legacy entitlement lookup for the synthetic id; every other statement reaches the database. */
function withSyntheticRights(pool, userId) {
  return {async connect() {
    const client = await pool.connect();
    return {
      query: (sql, args) => typeof sql === 'string' && /FROM resolute\.entitlements/.test(sql) && args?.[0] === userId
        ? Promise.resolve({rowCount: 1, rows: [{'?column?': 1}]}) : client.query(sql, args),
      release: () => client.release(),
    };
  }};
}
async function count(pool, sql, userId) {
  const client = await pool.connect();
  try { return (await client.query(sql, [userId])).rows[0]; } finally { client.release(); }
}
async function absent(planPool, notificationPool, userId) {
  const a = await count(planPool, `SELECT (SELECT count(*) FROM resolute.plans WHERE clerk_user_id=$1)::int AS plans,
    (SELECT count(*) FROM resolute.plan_deletions WHERE clerk_user_id=$1)::int AS deletions,
    (SELECT count(*) FROM resolute.protection_outbox WHERE clerk_user_id=$1)::int AS outbox`, userId);
  const b = await count(notificationPool, 'SELECT count(*)::int AS settings FROM resolute.notification_settings WHERE clerk_user_id=$1', userId);
  return a.plans === 0 && a.deletions === 0 && a.outbox === 0 && b.settings === 0;
}
async function verify(planPool, notificationPool, userId) {
  const plan = await count(planPool, 'SELECT plan IS NULL AS erased, revision::int AS revision, deleted_at IS NOT NULL AS deleted FROM resolute.plans WHERE clerk_user_id=$1', userId);
  const settings = await count(notificationPool, `SELECT revision::int AS revision, settings->>'alertsEnabled' AS alerts, settings->>'morningEnabled' AS morning
    FROM resolute.notification_settings WHERE clerk_user_id=$1`, userId);
  const client = await notificationPool.connect();
  let events;
  try {
    events = (await client.query(`SELECT kind,revision::int AS revision,(receipt_sha256 ~ '^[0-9a-f]{64}$' AND published_at IS NOT NULL) AS published
      FROM resolute.protection_outbox WHERE clerk_user_id=$1 ORDER BY kind`, [userId])).rows;
  } finally { client.release(); }
  const ok = plan?.erased === true && plan.deleted === true && plan.revision === 2 && settings?.revision === 2 &&
    settings.alerts === 'false' && settings.morning === 'false' && events.length === 3 && events.every(e => e.published) &&
    events.map(e => e.kind).join() === 'alerts_off,delete,morning_off' &&
    events.find(e => e.kind === 'delete').revision === 2 && events.find(e => e.kind === 'alerts_off').revision === 2 && events.find(e => e.kind === 'morning_off').revision === 2;
  if (!ok) throw new Stop('verify');
  return events.map(e => ({kind: e.kind, revision: e.revision, published: true}));
}
async function step(stage, run) { try { return await run(); } catch (error) { throw error instanceof Stop ? error : new Stop(stage); } }

/** deps (tests only): {pools:{plan,notification}, fetch}. Production builds pg pools from the scoped URLs. */
export async function main(env = process.env, deps = {}) {
  if (env.RESOLUTE_ACCEPTANCE_6B !== 'true') return {event: 'RESOLUTE_ACCEPTANCE_6B_DISABLED'};
  const userId = env.RESOLUTE_ACCEPTANCE_6B_USER ?? '';
  if (!USER_PATTERN.test(userId)) throw new Stop('config');
  // Customer saving must stay OFF, and the protection gateway is the only allowed storage path.
  if (env.RESOLUTE_PLAN_API_ENABLED === 'true' || env.RESOLUTE_NOTIFICATION_API_ENABLED === 'true') throw new Stop('config');
  let gateway;
  try { gateway = protectionGatewayConfig(env); } catch { throw new Stop('config'); }
  const planConfig = scopedConfig(env.RESOLUTE_PLAN_DB_URL, 'resolute_plan_writer');
  const notificationConfig = scopedConfig(env.RESOLUTE_NOTIFICATION_DB_URL, 'resolute_notification_writer');
  const owned = [];
  const make = config => { const pool = new pg.Pool(config); pool.on('error', () => {}); owned.push(pool); return pool; };
  const planPool = deps.pools?.plan ?? make(planConfig), notificationPool = deps.pools?.notification ?? make(notificationConfig);
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Stop('timeout')), TOTAL_TIMEOUT_MS); });
  const work = (async () => {
    const protect = createProtectionBarrier(createProtectionPublisher(protectionGatewayObjects(gateway.endpoint, gateway.token, deps.fetch ?? fetch), gateway.key));
    if (!await step('preflight', () => absent(planPool, notificationPool, userId))) throw new Stop('already-present');
    const plans = createPlanStore(withSyntheticRights(planPool, userId), 'legacy', protect);
    const notifications = createNotificationStore(withSyntheticRights(notificationPool, userId), 'legacy', protect);
    await step('plan-save', () => plans(userId, 'PUT', {baseRevision: 0, plan: PLAN}));
    await step('notification-on', () => notifications(userId, 'PUT', {baseRevision: 0, settings: ON}));
    await step('plan-delete', () => plans(userId, 'DELETE', {baseRevision: 1, plan: null}));
    await step('notification-off', () => notifications(userId, 'PUT', {baseRevision: 1, settings: OFF}));
    const events = await step('verify', () => verify(planPool, notificationPool, userId));
    return {event: 'RESOLUTE_ACCEPTANCE_6B_OK', database: 'resolute', events, objects: events.length, customerSaving: false,
      checks: ['synthetic-id-absent-before', 'plan-saved-then-deleted', 'both-notifications-off', 'outbox-3-published-with-receipts', 'readback-verified-by-publisher']};
  })();
  work.catch(() => {});
  try { return await Promise.race([work, deadline]); }
  finally { clearTimeout(timer); await Promise.allSettled(owned.map(pool => pool.end())); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(r => { console.log(JSON.stringify(r)); })
    .catch(e => { console.error(JSON.stringify({event: 'RESOLUTE_ACCEPTANCE_6B_FAILED', stage: e instanceof Stop ? e.stage : 'unknown'})); process.exit(1); });
}
