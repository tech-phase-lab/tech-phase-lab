/** Explicit one-time operator job. Never expose through HTTP or API startup. */
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {resolveResoluteEntitlements} from '../../lib/resolute/entitlements.ts';
const migration=readFileSync(new URL('../../db/resolute/001_entitlements.sql',import.meta.url),'utf8');
const url=new URL(process.env.RESOLUTE_SETUP_DB_URL);
if(url.hostname!=='postgres.railway.internal' || url.pathname!=='/resolute' ||
 !/^([a-f0-9]{64})$/.test(process.env.RESOLUTE_READER_PASSWORD ?? ''))throw Error('Invalid setup scope');
const client=new pg.Client({connectionString:url.toString(),ssl:false,connectionTimeoutMillis:10000,
 statement_timeout:10000,query_timeout:15000});
const password=process.env.RESOLUTE_READER_PASSWORD;
try {
 await client.connect();
 const existing=await client.query("SELECT to_regclass('resolute.entitlements') AS table_name");
 if(existing.rows[0].table_name)throw Error('Already provisioned: inspect before running again');
 await client.query('BEGIN');
 await client.query(migration.replace(/\bBEGIN;/,'').replace(/\bCOMMIT;/,''));
 await client.query(`CREATE ROLE resolute_api_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
 await client.query('GRANT CONNECT ON DATABASE resolute TO resolute_api_reader');
 await client.query('GRANT USAGE ON SCHEMA resolute TO resolute_api_reader');
 await client.query('GRANT SELECT ON resolute.entitlements TO resolute_api_reader');
 await client.query('ALTER ROLE resolute_api_reader IN DATABASE resolute SET default_transaction_read_only = on');
 await client.query('ALTER ROLE resolute_api_reader IN DATABASE resolute SET statement_timeout = 3000');
 await client.query('COMMIT');
 // Fixtures stay inside a transaction and are rolled back even after successful checks.
 await client.query('BEGIN');
 const rows=[['user_resoluteSetupBuyer','use',null,null],['user_resoluteSetupBuyer','alerts','2090-01-01',null],
 ['user_resoluteSetupExpired','use',null,null],['user_resoluteSetupExpired','alerts','2021-01-01',null],
 ['user_resoluteSetupRevoked','use',null,'2021-01-01'],['user_resoluteSetupRevoked','alerts','2090-01-01',null]];
 for(const [id,kind,end,revoked] of rows)await client.query(`INSERT INTO resolute.entitlements
 (clerk_user_id,product_id,kind,starts_at,expires_at,revoked_at,source)
 VALUES($1,'resolute_v1',$2,'2020-01-01',$3,$4,'admin')`,[id,kind,end,revoked]);
 await client.query('SET LOCAL ROLE resolute_api_reader');
 for(const [id,use,alerts] of [['user_resoluteSetupBuyer',true,true],['user_resoluteSetupExpired',true,false],
 ['user_resoluteSetupRevoked',false,false],['user_resoluteSetupOther',false,false]]){
  const result=await client.query('SELECT kind,starts_at,expires_at,revoked_at FROM resolute.entitlements WHERE clerk_user_id=$1 AND product_id=$2',[id,'resolute_v1']);
  const snapshot=resolveResoluteEntitlements(result.rows.map(r=>({kind:r.kind,startsAt:r.starts_at.toISOString(),
   expiresAt:r.expires_at?.toISOString()??null,revokedAt:r.revoked_at?.toISOString()??null})),new Date().toISOString());
  if(snapshot.canUseTools!==use || snapshot.canReceiveNotifications!==alerts)throw Error('Live DB state mismatch');
 }
 await client.query('SAVEPOINT write_probe');
 let denied=false;
 try{await client.query("UPDATE resolute.entitlements SET source='admin'");}catch{denied=true;}
 await client.query('ROLLBACK TO SAVEPOINT write_probe');
 if(!denied)throw Error('Reader unexpectedly permits writes');
 await client.query('ROLLBACK');
 const readerUrl=new URL(url);readerUrl.username='resolute_api_reader';readerUrl.password=password;
 const reader=new pg.Client({connectionString:readerUrl.toString(),ssl:false,connectionTimeoutMillis:10000});
 try{
  await reader.connect();
  const r=await reader.query("SELECT current_user, current_database(), current_setting('default_transaction_read_only') AS read_only, (SELECT count(*)::int FROM resolute.entitlements) AS count");
  if(r.rows[0].current_user!=='resolute_api_reader'||r.rows[0].current_database!=='resolute'||r.rows[0].read_only!=='on'||r.rows[0].count!==0)throw Error('Reader connection verification failed');
 }finally{await reader.end();}
 console.log(JSON.stringify({event:'RESOLUTE_PROVISION_OK',database:'resolute',role:'resolute_api_reader',
  checks:['buyer','expired-alerts','revoked-use','other-user','write-denied','reader-login','fixtures-rolled-back']}));
} catch {
 try{await client.query('ROLLBACK');}catch{}
 console.error('RESOLUTE_PROVISION_FAILED');process.exitCode=1;
} finally {await client.end();}
