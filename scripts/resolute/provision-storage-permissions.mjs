/** Explicit operator command. Never called by application startup. */
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {verifyStoragePermissions} from './storage-permissions.mjs';
const migration=readFileSync(new URL('../../db/resolute/019_storage_permissions.sql',import.meta.url),'utf8');
export async function prepareStoragePermissions(client){
 await client.query('BEGIN');
 try{
  await client.query('SELECT pg_advisory_xact_lock(7180419)');
  await client.query(migration.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));
  const result=await verifyStoragePermissions(client);
  await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK');throw error;}
}
export async function main(env=process.env){
 // Exact operation opt-in; importing or invoking without it performs no I/O.
 if(env.RESOLUTE_PREPARE_STORAGE_PERMISSIONS!=='true')return {event:'RESOLUTE_STORAGE_PREPARE_DISABLED'};
 const url=new URL(env.RESOLUTE_SETUP_DB_URL);
 if(url.protocol!=='postgresql:'||url.hostname!=='postgres.railway.internal'||url.pathname!=='/resolute')throw Error('INVALID_STORAGE_SCOPE');
 const client=new pg.Client({connectionString:url.toString(),ssl:false,connectionTimeoutMillis:10000,statement_timeout:10000,query_timeout:15000});
 try{
  await client.connect();return {event:'RESOLUTE_STORAGE_PERMISSIONS_PREPARED',...await prepareStoragePermissions(client),activation:false};
 }finally{await client.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('RESOLUTE_STORAGE_PERMISSIONS_PREPARE_FAILED');process.exitCode=1;});
}
