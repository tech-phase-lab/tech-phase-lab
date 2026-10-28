/** Explicit operator-only migration. Never creates login credentials or enables sales. */
import pg from 'pg';
import {readFileSync} from 'node:fs';
const migration=readFileSync(new URL('../../db/resolute/015_payments_live_role.sql',import.meta.url),'utf8');
let client;
try {
  const url=new URL(process.env.RESOLUTE_SETUP_DB_URL);
  if(url.hostname!=='postgres.railway.internal' || url.pathname!=='/resolute') throw Error('Invalid scope');
  client=new pg.Client({connectionString:url.toString(),ssl:false,connectionTimeoutMillis:10000,statement_timeout:10000,query_timeout:15000});
  await client.connect();await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(7180415)');
  await client.query(migration.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));
  const result=await client.query(`SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
    FROM pg_roles WHERE rolname='resolute_payment_live_writer'`);
  if(result.rowCount!==1 || Object.values(result.rows[0]).some(Boolean)) throw Error('Role is not dormant');
  const outside=await client.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','resolute_payments_live')
      AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','v','m','p')
      AND has_table_privilege('resolute_payment_live_writer',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')`);
  if(outside.rows[0].n!==0) throw Error('Unexpected unrelated table permissions');
  const forbidden=await client.query(`SELECT
    has_schema_privilege('resolute_payment_live_writer','resolute_payments_live','CREATE') AS ddl,
    has_schema_privilege('resolute_payment_live_writer','public','CREATE') AS public_ddl,
    has_database_privilege('resolute_payment_live_writer','resolute','CREATE') AS schema_ddl,
    has_table_privilege('resolute_payment_live_writer','resolute_payments_live.audit','UPDATE,DELETE,TRUNCATE') AS audit_mutation,
    has_table_privilege('resolute_payment_live_writer','resolute_payments_live.orders','DELETE,TRUNCATE') AS destructive,
    has_table_privilege('resolute_payment_live_writer','resolute_payments_live.events','UPDATE,DELETE,TRUNCATE') AS events_mutation`);
  if(Object.values(forbidden.rows[0]).some(Boolean)) throw Error('Unexpected permissions');
  await client.query('COMMIT');
  console.log(JSON.stringify({event:'RESOLUTE_LIVE_ROLE_PREPARED',login:false,credentialsCreated:false,
    unrelatedTablesAccessible:0,destructivePermissions:false,activation:false}));
} catch {
  try {await client?.query('ROLLBACK');} catch {}
  console.error('RESOLUTE_LIVE_ROLE_PREPARE_FAILED');process.exitCode=1;
} finally {await client?.end();}
