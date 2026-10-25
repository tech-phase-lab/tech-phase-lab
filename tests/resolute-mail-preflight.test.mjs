import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {inspectMailConfiguration} from '../lib/resolute/notification-mail-preflight.ts';

const fixture=()=>({
 RESOLUTE_MAIL_DELIVERY_ENABLED:'true',RESOLUTE_MAIL_STOP_ENABLED:'true',RESOLUTE_MAIL_FEEDBACK_ENABLED:'true',RESOLUTE_MAIL_MONITOR_ENABLED:'true',RESOLUTE_ENTITLEMENT_SOURCE:'live',
 RESOLUTE_NOTIFICATION_SENDER_DB_URL:'postgres://resolute_notification_sender:private-password@db.invalid/resolute',
 RESOLUTE_NOTIFICATION_DB_URL:'postgres://resolute_notification_writer:private-password@db.invalid/resolute',
 RESOLUTE_MAIL_PUBLIC_ORIGIN:'https://app.example.com',RESOLUTE_MAIL_STOP_KEY_HEX:'ab'.repeat(32),
 RESOLUTE_RESEND_API_KEY:'re_privateApiKey123',RESOLUTE_MAIL_FROM:'alerts@example.com',RESOLUTE_MAIL_CLERK_SECRET_KEY:'privateClerkKey',
 RESOLUTE_RESEND_WEBHOOK_SECRET:'whsec_'+Buffer.alloc(32,7).toString('base64'),
 RESOLUTE_PROTECTION_ENABLED:'true',RESOLUTE_PROTECTION_WRITER_URL:'https://fixture.up.railway.app',RESOLUTE_PROTECTION_WRITER_TOKEN:'z'.repeat(48),RESOLUTE_PROTECTION_KEY_HEX:'cd'.repeat(32),
});
test('offline preflight never claims production readiness or changes input',()=>{
 const env=Object.freeze(fixture());const result=inspectMailConfiguration(env);
 assert.equal(result.configurationValid,true);assert.equal(result.productionReady,false);
 assert.ok(result.unverified.includes('ja-en-mailbox-acceptance'));
 const output=JSON.stringify(result);for(const value of ['private-password','privateApiKey','privateClerkKey',env.RESOLUTE_RESEND_WEBHOOK_SECRET,env.RESOLUTE_MAIL_STOP_KEY_HEX])assert.ok(!output.includes(value));
});
test('offline preflight identifies missing stop, feedback and sender prerequisites',()=>{
 for(const key of Object.keys(fixture())){
  const env=fixture();delete env[key];const result=inspectMailConfiguration(env);
  assert.equal(result.configurationValid,false,key);assert.ok(result.checks.some(c=>!c.valid),key);
 }
});
test('offline preflight rejects crossed roles, reused keys and malformed webhook secret',()=>{
 for(const patch of [{RESOLUTE_NOTIFICATION_DB_URL:fixture().RESOLUTE_NOTIFICATION_SENDER_DB_URL},{RESOLUTE_MAIL_STOP_KEY_HEX:fixture().RESOLUTE_PROTECTION_KEY_HEX},{RESOLUTE_RESEND_WEBHOOK_SECRET:'whsec_!!!!'},{RESOLUTE_MAIL_PUBLIC_ORIGIN:'https://app.example.com/path'},{RESOLUTE_MAIL_FROM:'Alerts <alerts@example.com>'},{RESOLUTE_PROTECTION_ACCESS_KEY_ID:'forbidden'}])assert.equal(inspectMailConfiguration({...fixture(),...patch}).configurationValid,false);
});
test('offline CLI succeeds with deliberately unreachable hosts and fails closed with empty environment',()=>{
 for(const env of [{},fixture()]){
  const run=spawnSync(process.execPath,['--experimental-strip-types','services/resolute-api/mail-preflight.mjs'],{encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH,...env}});
  assert.equal(run.error,undefined);assert.equal(run.status,Object.keys(env).length?0:1);
  const report=JSON.parse(run.stdout);assert.equal(report.mode,'offline');assert.equal(report.productionReady,false);
  assert.ok(!run.stdout.includes('private-password'));
 }
});
