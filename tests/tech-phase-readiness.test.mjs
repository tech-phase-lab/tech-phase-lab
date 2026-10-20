import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxReadiness } from '../services/tech-phase-billing/readiness.mjs';
import { sandboxHandler } from '../services/tech-phase-billing/http.mjs';

const configured = () => ({
  VERCEL_ENV: 'preview', TECH_PHASE_PAYPAL_ENV: 'sandbox',
  TECH_PHASE_PAYPAL_CLIENT_ID: 'private-client', TECH_PHASE_PAYPAL_CLIENT_SECRET: 'private-secret',
  TECH_PHASE_PAYPAL_WEBHOOK_ID: 'private-webhook',
  TECH_PHASE_PAYPAL_PLAN_JPY: `P-${'A'.repeat(24)}`,
  TECH_PHASE_PAYPAL_PLAN_USD: `P-${'B'.repeat(24)}`,
  TECH_PHASE_BILLING_SANDBOX_DATABASE_URL: 'postgres://tech_phase_billing_sandbox_writer:private-password@db.example.test/tech_phase_billing_sandbox',
});
test('billing readiness does not mistake configuration for a verified connection or enabled sales', () => {
  const result = sandboxReadiness(configured());
  assert.equal(result.configurationReady, true);
  assert.equal(result.connectionVerified, false);
  assert.equal(result.enabled, false);
  assert.doesNotMatch(JSON.stringify(result), /private-|example\.test|P-AAAA/);
  const onlyResolute = sandboxReadiness({VERCEL_ENV:'preview', RESOLUTE_PAYPAL_CLIENT_ID:'existing', RESOLUTE_PAYMENT_DB_URL:'existing'});
  assert.equal(onlyResolute.missing.length, 7);
  assert.equal(onlyResolute.configurationReady, false);
});
test('billing readiness catches cross-service DB, private network and shared currency plan mistakes', () => {
  for (const [url,problem] of [
    ['postgres://resolute_writer:secret@db.example.test/resolute','invalid-database-config'],
    ['postgres://tech_phase_billing_sandbox_writer:secret@postgres.railway.internal/tech_phase_billing_sandbox','database-network-unreachable'],
    ['%invalid-secret','invalid-database-config'],
  ]) {
    const env=configured();env.TECH_PHASE_BILLING_SANDBOX_DATABASE_URL=url;
    const result=sandboxReadiness(env);
    assert.equal(result.configurationReady,false);assert.ok(result.problems.includes(problem));
    assert.ok(!JSON.stringify(result).includes(url));
  }
  const env=configured();env.TECH_PHASE_PAYPAL_PLAN_USD=env.TECH_PHASE_PAYPAL_PLAN_JPY;
  assert.ok(sandboxReadiness(env).problems.includes('distinct-currency-plans-required'));
});
test('owner can diagnose disabled preview billing without initializing payment services', async () => {
  let user=null;const env={VERCEL_ENV:'preview'};
  const handler=sandboxHandler({env,identity:async()=>user,ownerId:'owner',services:()=>{assert.fail('diagnosis must never initialize services');}});
  const request=()=>new Request('https://example.test/api/research/billing/sandbox/readiness');
  assert.equal((await handler(request(),'readiness')).status,401);
  user='other';assert.equal((await handler(request(),'readiness')).status,403);
  user='owner';const result=await handler(request(),'readiness');
  assert.equal(result.status,200);assert.equal((await result.json()).configurationReady,false);
  assert.equal(result.headers.get('cache-control'),'private, no-store');
  assert.equal((await handler(new Request(request(),{method:'POST'}),'readiness')).status,405);
  assert.equal((await handler(request(),'create')).status,503);
  env.VERCEL_ENV='production';assert.equal((await handler(request(),'readiness')).status,503);
});
