// Explicit one-shot provisioning job; never imported by the API server.
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {databaseConfig} from './core.mjs';
let client;
try {
  if(process.env.TECH_PHASE_RADAR_PROVISION_CONFIRM!=='create-financial-radar-only')throw Error('CONFIRM_REQUIRED');
  const password=process.env.TECH_PHASE_RADAR_DB_PASSWORD;
  if(!password || !/^[A-Za-z0-9_-]{32,128}$/.test(password))throw Error('PASSWORD_INVALID');
  client=new pg.Client(databaseConfig(process.env,true));await client.connect();
  const current=await client.query('SELECT current_database() AS name');
  if(current.rows[0].name!==process.env.TECH_PHASE_RADAR_DATABASE_NAME)throw Error('DATABASE_MISMATCH');
  if((await client.query("SELECT 1 FROM pg_roles WHERE rolname='tech_phase_radar_writer'")).rowCount)throw Error('ROLE_EXISTS_INSPECT_BEFORE_RETRY');
  await client.query('BEGIN');
  const sql=readFileSync(new URL('../../scripts/tech-phase/financial-radar-schema.sql',import.meta.url),'utf8').replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
  await client.query(sql);
  await client.query(`CREATE ROLE tech_phase_radar_writer LOGIN PASSWORD ${pg.escapeLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
  await client.query(`GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(current.rows[0].name)} TO tech_phase_radar_writer`);
  await client.query('GRANT USAGE ON SCHEMA public TO tech_phase_radar_writer');
  await client.query('GRANT SELECT,INSERT,UPDATE ON public.tech_phase_financial_radar TO tech_phase_radar_writer');
  const other=await client.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','f') AND c.oid<>'public.tech_phase_financial_radar'::regclass AND has_table_privilege('tech_phase_radar_writer',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') LIMIT 1");
  if(other.rowCount)throw Error('UNEXPECTED_EXISTING_TABLE_ACCESS');
  await client.query('COMMIT');console.log('RADAR_PROVISIONED');
}catch{await client?.query('ROLLBACK').catch(()=>{});console.error('RADAR_PROVISION_FAILED');process.exitCode=1;}
finally{await client?.end();}
