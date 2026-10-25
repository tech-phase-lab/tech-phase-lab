import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { livePreflight } from '../services/tech-phase-billing/live-preflight.mjs';
const fixture = () => ({
  TECH_PHASE_PAYPAL_ENV: 'live', VERCEL_ENV: 'production',
  TECH_PHASE_BILLING_LIVE_ORIGIN: 'https://techphase-fixture.com',
  TECH_PHASE_BILLING_RUNTIME: 'railway-live', TECH_PHASE_BILLING_LIVE_BRANCH: 'codex/research-preview', RAILWAY_GIT_BRANCH: 'codex/research-preview',
  TECH_PHASE_BILLING_LIVE_DATABASE_URL: 'postgresql://tech_phase_billing_live_writer:SECRET_DB@db.fixture/tech_phase_billing_live?sslmode=verify-full',
  TECH_PHASE_BILLING_LIVE_SERVICE_URL: 'https://fixture.up.railway.app', TECH_PHASE_BILLING_LIVE_SERVICE_TOKEN: 'T'.repeat(43),
  TECH_PHASE_PAYPAL_LIVE_CLIENT_ID: 'SECRET_ID', TECH_PHASE_PAYPAL_LIVE_CLIENT_SECRET: 'SECRET_PAYPAL', TECH_PHASE_PAYPAL_LIVE_WEBHOOK_ID: 'SECRET_WEBHOOK',
  TECH_PHASE_PAYPAL_LIVE_PLAN_JPY: `P-${'A'.repeat(24)}`, TECH_PHASE_PAYPAL_LIVE_PLAN_USD: `P-${'B'.repeat(24)}`,
});

test('offline preflight checks each deployment role without claiming connection or launch readiness', () => {
  for (const role of ['web', 'api', 'recovery']) {
    const env = Object.freeze(fixture());
    const report = livePreflight(env, role);
    assert.equal(report.configurationReady, true);
    assert.equal(report.preparationSafe, true);
    assert.equal(report.connectionVerified, false);
    assert.equal(report.launchReady, false);
    const serialized = JSON.stringify(report);
    for (const secret of Object.values(env)) assert.ok(!serialized.includes(secret), secret);
    assert.equal(livePreflight({}, role).configurationReady, false);
  }
});

test('wrong environment, currency plan reuse, DB scope, domain and runtime cannot pass', () => {
  for (const [key, value, role] of [
    ['TECH_PHASE_PAYPAL_ENV', 'sandbox', 'api'], ['VERCEL_ENV', 'preview', 'web'],
    ['TECH_PHASE_BILLING_LIVE_ORIGIN', 'https://fixture.vercel.app', 'web'],
    ['TECH_PHASE_PAYPAL_LIVE_PLAN_USD', `P-${'A'.repeat(24)}`, 'api'],
    ['TECH_PHASE_BILLING_LIVE_DATABASE_URL', 'postgresql://admin:SECRET@db.fixture/resolute', 'api'],
    ['RAILWAY_GIT_BRANCH', 'other-branch', 'api'], ['TECH_PHASE_BILLING_RUNTIME', 'railway-sandbox', 'api'],
    ['TECH_PHASE_BILLING_LIVE_SERVICE_TOKEN', 'short', 'web'], ['TECH_PHASE_BILLING_LIVE_RECOVERY_LIMIT', '26', 'recovery'],
  ]) assert.equal(livePreflight({ ...fixture(), [key]: value }, role).configurationReady, false, key);
  assert.equal(livePreflight({ ...fixture(), TECH_PHASE_PAYPAL_LIVE_CLIENT_SECRET: '' }, 'api').missing.includes('TECH_PHASE_PAYPAL_LIVE_CLIENT_SECRET'), true);
  assert.throws(() => livePreflight(fixture(), 'invalid'), /INVALID_PREFLIGHT_ROLE/);
});

test('active or malformed flags are reported without modifying them or exposing their values', () => {
  const env = Object.freeze({ ...fixture(), TECH_PHASE_BILLING_LIVE_SALES_ENABLED: 'true' });
  assert.deepEqual(livePreflight(env, 'api').activeFlags, ['TECH_PHASE_BILLING_LIVE_SALES_ENABLED']);
  assert.equal(livePreflight(env, 'api').preparationSafe, false);
  assert.equal(env.TECH_PHASE_BILLING_LIVE_SALES_ENABLED, 'true');
  const invalid = livePreflight({ ...fixture(), TECH_PHASE_BILLING_LIVE_ENABLED: 'SECRET_TYPO' }, 'web');
  assert.equal(invalid.configurationReady, false);
  assert.doesNotMatch(JSON.stringify(invalid), /SECRET_TYPO/);
});

test('CLI works with all outbound connections blocked and returns nonzero for missing configuration', () => {
  const preload = 'import net from "node:net";import tls from "node:tls";const deny=()=>{process.stderr.write("NETWORK_ATTEMPT");throw Error("blocked")};globalThis.fetch=deny;net.connect=deny;net.createConnection=deny;tls.connect=deny;';
  const run = (env, role) => spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, 'scripts/tech-phase/check_live_config.mjs', role], { cwd: new URL('..', import.meta.url), env, encoding: 'utf8', timeout: 10000 });
  for (const role of ['web', 'api', 'recovery']) {
    const complete = run(fixture(), role);
    assert.equal(complete.status, 0, complete.stderr);
    assert.equal(JSON.parse(complete.stdout).connectionVerified, false);
    assert.doesNotMatch(complete.stdout + complete.stderr, /SECRET_|NETWORK_ATTEMPT/);
    const missing = run({}, role);
    assert.equal(missing.status, 1);
    assert.ok(JSON.parse(missing.stdout).missing.length > 0);
  }
  assert.equal(run({}, 'bad').status, 2);
});
