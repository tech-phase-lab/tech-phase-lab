/** Explicit one-time operator job for the owner-only test mail. Never exposed through HTTP, API startup or any worker.
 * Customer saving (RESOLUTE_PLAN_API_ENABLED / RESOLUTE_NOTIFICATION_API_ENABLED) stays OFF. This job runs the same store code
 * the API uses, through the same least-privilege roles and the protection barrier, for ONE account only:
 * PRODUCTION_OWNER_ACCOUNT_ID. Any other id is impossible (there is no id input).
 *
 *   RESOLUTE_OWNER_TEST_SEED=on   saves a test plan (two buy lines) and notification settings with alerts ON and the
 *                                  morning note ON for one symbol, one reference price and one delivery hour (environment).
 *                                  Refuses if the owner already has a plan row or settings row (never overwrites real data).
 *   RESOLUTE_OWNER_TEST_SEED=off   after the test: both notification choices OFF, watch list emptied, and the test plan
 *                                  deleted only if it is still the plan this job saved (marker); a real plan is left alone.
 *
 * The one deviation from the API path (as in step 6b): the legacy entitlement SELECT for the owner id is answered locally,
 * because the owner has no entitlement row and the writer roles cannot create one. Nothing else is bypassed.
 * Output: the event name, revisions and published flags only. No id, symbol, price, URL, token or key is ever printed.
 * Any error stops it at once: no retry, no schema change, no key creation.
 */
import pg from 'pg';
import {pathToFileURL} from 'node:url';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {createPlanStore} from '../../lib/resolute/plan-database.ts';
import {createNotificationStore} from '../../lib/resolute/notification-database.ts';
import {parseNotificationSettings} from '../../lib/resolute/notification-settings.ts';
import {protectionGatewayConfig,protectionGatewayObjects} from '../../lib/resolute/protection-runtime.ts';
import {createProtectionPublisher} from '../../lib/resolute/protection-ledger.ts';
import {createProtectionBarrier} from '../../lib/resolute/protection-outbox.ts';
import {emptyPlanAnswers} from '../../lib/resolute/plan-answers.ts';
import {PRODUCTION_OWNER_ACCOUNT_ID} from '../../lib/membership/entitlements.ts';

const TOTAL_TIMEOUT_MS = 90000;
const MARKER = 'owner-test-seed';
class Stop extends Error { constructor(stage) { super(stage); this.stage = stage; } }

const PLAN = {schemaVersion: 1, answersVersion: 1, answers: emptyPlanAnswers(), fx: {thresholdYen: null, usdJpy: null, note: MARKER},
  currency: 'JPY', monthlyLivingCost: 250000, savingsMonths: 12, reserveMonths: 6, nearTermExpense: 0, financialAssets: 10000000,
  investedAmount: 3000000, investable: 8500000, tolerancePct: 20, toleranceDrop: 600000, perStockCapPct: 20, buyMode: 'steps',
  buyLines: [{dropPct: 10, amount: 100000}, {dropPct: 20, amount: 100000}], buyBudgetPct: 10, allocation: 'equal',
  noBuyConditions: [], haltConditions: [], ruleType: 'undecided'};

function scopedConfig(value, role) {
  let config;
  try { config = resoluteDatabaseConfig(value); } catch { throw new Stop('config'); }
  const url = new URL(config.connectionString);
  if (url.hostname !== 'postgres.railway.internal' || decodeURIComponent(url.pathname) !== '/resolute' || url.username !== role) throw new Stop('config');
  return config;
}
/** Answers only the legacy entitlement lookup for the owner id; every other statement reaches the database. */
function withOwnerRights(pool) {
  return {async connect() {
    const client = await pool.connect();
    return {
      query: (sql, args) => typeof sql === 'string' && /FROM resolute\.entitlements/.test(sql) && args?.[0] === PRODUCTION_OWNER_ACCOUNT_ID
        ? Promise.resolve({rowCount: 1, rows: [{'?column?': 1}]}) : client.query(sql, args),
      release: () => client.release(),
    };
  }};
}
async function one(pool, sql) {
  const client = await pool.connect();
  try { return (await client.query(sql, [PRODUCTION_OWNER_ACCOUNT_ID])).rows[0]; } finally { client.release(); }
}
async function step(stage, run) { try { return await run(); } catch (error) { throw error instanceof Stop ? error : new Stop(stage); } }

/** The test settings from the environment, validated by the same parser the API uses. */
export function testSettings(env) {
  const symbol = env.RESOLUTE_OWNER_TEST_SYMBOL ?? '', price = Number(env.RESOLUTE_OWNER_TEST_REFERENCE_PRICE ?? ''), hour = Number(env.RESOLUTE_OWNER_TEST_HOUR ?? '');
  try {
    return parseNotificationSettings({deliveryHourJst: hour, alertsEnabled: true, morningEnabled: true, watchItems: [{symbol, referencePrice: price}], surgeCapPct: null});
  } catch { throw new Stop('config'); }
}
const OFF = {deliveryHourJst: 7, alertsEnabled: false, morningEnabled: false, watchItems: [], surgeCapPct: null};

async function events(pool, kinds) {
  const client = await pool.connect();
  try {
    return (await client.query(`SELECT kind,revision::int AS revision,(receipt_sha256 ~ '^[0-9a-f]{64}$' AND published_at IS NOT NULL) AS published
      FROM resolute.protection_outbox WHERE clerk_user_id=$1 AND kind = ANY($2) ORDER BY kind`, [PRODUCTION_OWNER_ACCOUNT_ID, kinds])).rows;
  } finally { client.release(); }
}

/** deps (tests only): {pools:{plan,notification}, fetch}. Production builds pg pools from the scoped URLs. */
export async function main(env = process.env, deps = {}) {
  const mode = env.RESOLUTE_OWNER_TEST_SEED;
  if (mode !== 'on' && mode !== 'off') return {event: 'RESOLUTE_OWNER_TEST_SEED_DISABLED'};
  // Customer saving must stay OFF, and the protection gateway is the only allowed storage path.
  if (env.RESOLUTE_PLAN_API_ENABLED === 'true' || env.RESOLUTE_NOTIFICATION_API_ENABLED === 'true') throw new Stop('config');
  const settings = mode === 'on' ? testSettings(env) : undefined;
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
    const plans = createPlanStore(withOwnerRights(planPool), 'legacy', protect);
    const notifications = createNotificationStore(withOwnerRights(notificationPool), 'legacy', protect);
    const U = PRODUCTION_OWNER_ACCOUNT_ID;
    if (mode === 'on') {
      const before = await step('preflight', async () => ({plan: await one(planPool, 'SELECT count(*)::int AS n FROM resolute.plans WHERE clerk_user_id=$1'),
        settings: await one(notificationPool, 'SELECT count(*)::int AS n FROM resolute.notification_settings WHERE clerk_user_id=$1')}));
      if (before.plan.n !== 0 || before.settings.n !== 0) throw new Stop('already-present');
      await step('plan-save', () => plans(U, 'PUT', {baseRevision: 0, plan: PLAN}));
      await step('settings-on', () => notifications(U, 'PUT', {baseRevision: 0, settings}));
      const ok = await step('verify', async () => {
        const p = await one(planPool, "SELECT revision::int AS revision, plan->'fx'->>'note' AS note FROM resolute.plans WHERE clerk_user_id=$1");
        const s = await one(notificationPool, "SELECT revision::int AS revision, settings->>'alertsEnabled' AS alerts, settings->>'morningEnabled' AS morning FROM resolute.notification_settings WHERE clerk_user_id=$1");
        return p?.revision === 1 && p.note === MARKER && s?.revision === 1 && s.alerts === 'true' && s.morning === 'true';
      });
      if (!ok) throw new Stop('verify');
      return {event: 'RESOLUTE_OWNER_TEST_SEED_ON_OK', database: 'resolute', planRevision: 1, settingsRevision: 1, customerSaving: false,
        checks: ['owner-rows-absent-before', 'test-plan-saved', 'alerts-and-morning-on', 'readback-verified']};
    }
    // mode === 'off'
    const current = await step('preflight', async () => ({
      s: await one(notificationPool, 'SELECT revision::int AS revision FROM resolute.notification_settings WHERE clerk_user_id=$1'),
      p: await one(planPool, "SELECT revision::int AS revision, plan->'fx'->>'note' AS note, (plan IS NULL) AS erased FROM resolute.plans WHERE clerk_user_id=$1")}));
    if (!current.s) throw new Stop('not-present');
    await step('settings-off', () => notifications(U, 'PUT', {baseRevision: current.s.revision, settings: OFF}));
    const deletePlan = !!current.p && !current.p.erased && current.p.note === MARKER;
    if (deletePlan) await step('plan-delete', () => plans(U, 'DELETE', {baseRevision: current.p.revision, plan: null}));
    const kinds = deletePlan ? ['alerts_off', 'delete', 'morning_off'] : ['alerts_off', 'morning_off'];
    const result = await step('verify', async () => {
      const s = await one(notificationPool, "SELECT revision::int AS revision, settings->>'alertsEnabled' AS alerts, settings->>'morningEnabled' AS morning, jsonb_array_length(settings->'watchItems')::int AS items FROM resolute.notification_settings WHERE clerk_user_id=$1");
      const ev = await events(notificationPool, kinds);
      const ok = s?.revision === current.s.revision + 1 && s.alerts === 'false' && s.morning === 'false' && s.items === 0 &&
        ev.length === kinds.length && ev.every(e => e.published) && ev.map(e => e.kind).join() === kinds.join();
      if (!ok) throw new Stop('verify');
      return ev.map(e => ({kind: e.kind, revision: e.revision, published: true}));
    });
    return {event: 'RESOLUTE_OWNER_TEST_SEED_OFF_OK', database: 'resolute', settingsRevision: current.s.revision + 1, testPlanDeleted: deletePlan,
      events: result, customerSaving: false, checks: ['both-notifications-off', 'watch-list-emptied', deletePlan ? 'test-plan-deleted' : 'real-plan-untouched', 'outbox-published-with-receipts']};
  })();
  work.catch(() => {});
  try { return await Promise.race([work, deadline]); }
  finally { clearTimeout(timer); await Promise.allSettled(owned.map(pool => pool.end())); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(r => { console.log(JSON.stringify(r)); })
    .catch(e => { console.error(JSON.stringify({event: 'RESOLUTE_OWNER_TEST_SEED_FAILED', stage: e instanceof Stop ? e.stage : 'unknown'})); process.exit(1); });
}
