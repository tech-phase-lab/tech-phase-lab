/** Read-only replacement for the completed one-time provisioning job. */
import pg from 'pg';
import {pathToFileURL} from 'node:url';

export function readerConnection(env) {
 const url=new URL(env.RESOLUTE_SETUP_DB_URL);
 if(url.hostname!=='postgres.railway.internal' || url.pathname!=='/resolute' ||
  !/^[a-f0-9]{64}$/.test(env.RESOLUTE_READER_PASSWORD ?? ''))throw Error('Invalid verification scope');
 url.username='resolute_api_reader';url.password=env.RESOLUTE_READER_PASSWORD;
 return {connectionString:url.toString(),ssl:false,connectionTimeoutMillis:10000,
  statement_timeout:3000,query_timeout:5000};
}

export async function verifyReader(client) {
 const result=await client.query(`SELECT current_user, current_database(),
  current_setting('default_transaction_read_only') AS read_only,
  has_table_privilege(current_user,'resolute.entitlements','SELECT') AS can_read,
  has_table_privilege(current_user,'resolute.entitlements','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS can_write,
  has_schema_privilege(current_user,'resolute','CREATE') AS can_create,
  (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS elevated,
  (SELECT count(*)::int FROM resolute.entitlements WHERE clerk_user_id IN
   ('user_resoluteSetupBuyer','user_resoluteSetupExpired','user_resoluteSetupRevoked','user_resoluteSetupOther')) AS fixtures`);
 const r=result.rows[0];
 if(!r || r.current_user!=='resolute_api_reader' || r.current_database!=='resolute' ||
  r.read_only!=='on' || r.can_read!==true || r.can_write!==false || r.can_create!==false ||
  r.elevated!==false || r.fixtures!==0)throw Error('Reader verification failed');
 // Exercise the same columns as the API without creating an entitlement or assuming an empty DB.
 await client.query('SELECT kind,starts_at,expires_at,revoked_at FROM resolute.entitlements WHERE clerk_user_id=$1 AND product_id=$2',
  ['user_resoluteSetupOther','resolute_v1']);
 return {event:'RESOLUTE_READER_VERIFIED',database:'resolute',role:'resolute_api_reader',
  checks:['reader-login','schema-read','no-write-privileges','no-elevated-role','fixtures-rolled-back'],writes:0};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 let client;
 try {
  client=new pg.Client(readerConnection(process.env));await client.connect();
  console.log(JSON.stringify(await verifyReader(client)));
 }catch{console.error('RESOLUTE_READER_VERIFICATION_FAILED');process.exitCode=1;}
 finally{if(client)await client.end();}
}
