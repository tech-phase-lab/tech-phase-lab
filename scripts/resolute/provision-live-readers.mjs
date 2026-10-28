/** Operator-only, atomic view grants. No credentials, sales or source switches. */
import pg from 'pg';
import {readFileSync} from 'node:fs';
const migration=readFileSync(new URL('../../db/resolute/016_live_entitlement_readers.sql',import.meta.url),'utf8');
const roles=['resolute_api_reader','resolute_plan_writer','resolute_notification_writer'];
let client;
try {
 const url=new URL(process.env.RESOLUTE_SETUP_DB_URL);
 if(url.protocol!=='postgresql:' || url.hostname!=='postgres.railway.internal' || url.pathname!=='/resolute') throw Error('Invalid scope');
 client=new pg.Client({connectionString:url.toString(),ssl:false,connectionTimeoutMillis:10000,statement_timeout:10000,query_timeout:15000});
 await client.connect();await client.query('BEGIN');
 await client.query('SELECT pg_advisory_xact_lock(7180416)');
 await client.query(migration.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));
 for(const role of roles) {
  const check=await client.query(`SELECT
   has_schema_privilege($1,'resolute_payments_live','USAGE') AS usage,
   has_schema_privilege($1,'resolute_payments_live','CREATE') AS ddl,
   has_table_privilege($1,'resolute_payments_live.entitlement_periods','SELECT') AS readable,
   has_table_privilege($1,'resolute_payments_live.entitlement_periods','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS writable,
   (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='resolute_payments_live' AND c.relkind IN ('r','v','m','p')
    AND c.relname<>'entitlement_periods' AND has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS raw_access`,[role]);
  const r=check.rows[0];if(!r.usage || !r.readable || r.ddl || r.writable || r.raw_access!==0)throw Error('Unexpected live permissions');
  // Static allowlist only. Exercise the view as the consumer without exposing rows.
  await client.query(`SET LOCAL ROLE ${role}`);
  await client.query('SELECT clerk_user_id,product_id,kind,starts_at,expires_at FROM resolute_payments_live.entitlement_periods LIMIT 0');
  await client.query('RESET ROLE');
 }
 await client.query('COMMIT');
 console.log(JSON.stringify({event:'RESOLUTE_LIVE_READERS_PREPARED',rolesVerified:roles.length,viewOnly:true,rawPaymentAccess:false,credentialsChanged:false,activation:false}));
} catch {
 try{await client?.query('ROLLBACK');}catch{}
 console.error('RESOLUTE_LIVE_READERS_PREPARE_FAILED');process.exitCode=1;
} finally{await client?.end();}
