import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {main,enableMailSenderLogin} from '../scripts/resolute/enable-mail-sender-login.mjs';

test('sender login job does nothing unless explicitly enabled and refuses a wrong scope',async()=>{
 assert.deepEqual(await main({}),{event:'RESOLUTE_MAIL_SENDER_LOGIN_DISABLED'});
 const base={RESOLUTE_ENABLE_MAIL_SENDER_LOGIN:'true',RESOLUTE_SETUP_DB_URL:'postgresql://u:p@postgres.railway.internal:5432/resolute',RESOLUTE_NOTIFICATION_SENDER_PASSWORD:'a'.repeat(64)};
 for(const patch of [{RESOLUTE_SETUP_DB_URL:'postgresql://u:p@example.com:5432/resolute'},{RESOLUTE_SETUP_DB_URL:'postgresql://u:p@postgres.railway.internal:5432/other'},{RESOLUTE_NOTIFICATION_SENDER_PASSWORD:'short'}])
  await assert.rejects(main({...base,...patch}),/Invalid setup scope/);
});
const SCHEMA=`CREATE SCHEMA resolute; CREATE SCHEMA resolute_payments_live;
 CREATE TABLE resolute.plans(id text,revision int); CREATE TABLE resolute.notification_settings(id text,clerk_user_id text,settings jsonb,revision int);
 CREATE TABLE resolute.notification_state(clerk_user_id text);
 CREATE TABLE resolute.notification_outbox(idempotency_key text,kind text,payload jsonb,accepted_at timestamptz,clerk_user_id text,delivery_date_jst date,created_at timestamptz DEFAULT now());
 CREATE TABLE resolute_payments_live.entitlement_periods(id text);`;
async function db(){
 const {PGlite}=await import('@electric-sql/pglite');
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();
 return new PGlite({database:'resolute',loadDataDir:data});
}
test('enables login only for the exact 020 minimum; stops when the role is missing, already enabled, or over-privileged',async()=>{
 const d=await db();
 try{
  await d.exec(SCHEMA);
  await assert.rejects(enableMailSenderLogin(d,'b'.repeat(64)),/Role missing/);
  await d.exec(readFileSync(new URL('../db/resolute/020_mail_sender_permissions.sql',import.meta.url),'utf8'));
  assert.equal((await d.query("SELECT rolcanlogin FROM pg_roles WHERE rolname='resolute_notification_sender'")).rows[0].rolcanlogin,false);
  await enableMailSenderLogin(d,'b'.repeat(64));
  assert.equal((await d.query("SELECT rolcanlogin FROM pg_roles WHERE rolname='resolute_notification_sender'")).rows[0].rolcanlogin,true);
  assert.equal((await d.query('SELECT count(*)::int AS n FROM resolute.notification_outbox')).rows[0].n,0);
  assert.equal((await d.query("SELECT to_regclass('resolute.sender_probe') AS t")).rows[0].t,null);
  await assert.rejects(enableMailSenderLogin(d,'c'.repeat(64)),/Login already enabled/);
 }finally{await d.close();}
});
test('a sender role with extra access is not enabled',async()=>{
 const d=await db();
 try{
  await d.exec(SCHEMA);
  await d.exec(readFileSync(new URL('../db/resolute/020_mail_sender_permissions.sql',import.meta.url),'utf8'));
  await d.exec('GRANT INSERT ON resolute.notification_outbox TO resolute_notification_sender');
  await assert.rejects(enableMailSenderLogin(d,'b'.repeat(64)),/unexpectedly permits outbox-insert/);
  assert.equal((await d.query("SELECT rolcanlogin FROM pg_roles WHERE rolname='resolute_notification_sender'")).rows[0].rolcanlogin,false);
 }finally{await d.close();}
});
