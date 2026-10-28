/** Read-only dormant-storage preflight. A snapshot is NOT a recovery write fence. */
import pg from 'pg';
import {pathToFileURL} from 'node:url';
import {storageRoles,verifyStoragePermissions} from './storage-permissions.mjs';
export async function checkStorageReadiness(client){
 await client.query('BEGIN READ ONLY');
 try{
  const acl=await verifyStoragePermissions(client);
  // NOLOGIN does not disconnect sessions opened before the role was disabled.
  const {rows:[activity]}=await client.query(`SELECT count(*)::text AS sessions
   FROM pg_stat_activity WHERE usename=ANY($1::text[])`,[storageRoles]);
  const {rows:[queue]}=await client.query(`SELECT count(*)::text AS pending,
   count(*) FILTER (WHERE next_attempt_at<=statement_timestamp())::text AS due
   FROM resolute.protection_outbox WHERE published_at IS NULL`);
  const sessions=Number(activity?.sessions),pending=Number(queue?.pending),due=Number(queue?.due);
  if(![sessions,pending,due].every(n=>Number.isSafeInteger(n)&&n>=0)||due>pending)throw Error('INVALID_STORAGE_READINESS_STATE');
  await client.query('ROLLBACK');
  return {event:'RESOLUTE_STORAGE_READINESS',...acl,activeScopedSessions:sessions,
   pendingProtection:pending,dueProtection:due,dormantChecksPassed:sessions===0&&pending===0,
   recoveryFenceVerified:false,activation:false};
 }catch(error){await client.query('ROLLBACK');throw error;}
}
export async function main(env=process.env){
 if(env.RESOLUTE_CHECK_STORAGE_READINESS!=='true')return {event:'RESOLUTE_STORAGE_READINESS_DISABLED'};
 const url=new URL(env.RESOLUTE_SETUP_DB_URL);
 if(url.protocol!=='postgresql:'||url.hostname!=='postgres.railway.internal'||url.pathname!=='/resolute'||url.search||url.hash)throw Error('INVALID_STORAGE_SCOPE');
 const client=new pg.Client({connectionString:url.toString(),ssl:false,connectionTimeoutMillis:10000,
  statement_timeout:10000,query_timeout:15000,idle_in_transaction_session_timeout:20000});
 try{await client.connect();return await checkStorageReadiness(client);}finally{await client.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().then(result=>{console.log(JSON.stringify(result));if(result.dormantChecksPassed===false)process.exitCode=1;})
 .catch(()=>{console.error('{"event":"RESOLUTE_STORAGE_READINESS_FAILED"}');process.exitCode=1;});
}
