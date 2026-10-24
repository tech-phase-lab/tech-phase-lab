/** Read-only acceptance of an explicitly provisioned scoped login; never grants access. */
import pg from 'pg';
import {pathToFileURL} from 'node:url';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {storageRoles,verifyStoragePermissions} from './storage-permissions.mjs';

export async function checkStorageRuntime(client,role,loginRoles){
 if(!storageRoles.includes(role)||!Array.isArray(loginRoles)||!loginRoles.includes(role))throw Error('INVALID_RUNTIME_SCOPE');
 await client.query('BEGIN READ ONLY');
 try{
  const {rows:[identity]}=await client.query('SELECT session_user AS login,current_user AS effective');
  // SET ROLE under an administrator is not evidence of a real scoped connection.
  if(identity?.login!==role||identity?.effective!==role)throw Error('INVALID_RUNTIME_IDENTITY');
  const acl=await verifyStoragePermissions(client,{loginRoles});
  await client.query('ROLLBACK');
  return {event:'RESOLUTE_STORAGE_RUNTIME_VERIFIED',role,...acl,readOnly:true,
   recoveryFenceVerified:false,activation:false};
 }catch(error){await client.query('ROLLBACK');throw error;}
}
export async function main(env=process.env){
 if(env.RESOLUTE_CHECK_STORAGE_RUNTIME!=='true')return {event:'RESOLUTE_STORAGE_RUNTIME_DISABLED'};
 const config=resoluteDatabaseConfig(env.RESOLUTE_STORAGE_CHECK_DB_URL);
 const url=new URL(config.connectionString),role=decodeURIComponent(url.username);
 const loginRoles=JSON.parse(env.RESOLUTE_STORAGE_EXPECTED_LOGIN_ROLES??'null');
 if(url.hostname!=='postgres.railway.internal'||!storageRoles.includes(role)||
  !Array.isArray(loginRoles)||!loginRoles.includes(role)||new Set(loginRoles).size!==loginRoles.length||
  loginRoles.some(value=>!storageRoles.includes(value)))throw Error('INVALID_RUNTIME_SCOPE');
 const client=new pg.Client({...config,application_name:'resolute-storage-readonly-check',
  statement_timeout:10000,query_timeout:15000,idle_in_transaction_session_timeout:20000});
 try{await client.connect();return await checkStorageRuntime(client,role,loginRoles);}finally{await client.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().then(result=>console.log(JSON.stringify(result)))
 .catch(()=>{console.error('{"event":"RESOLUTE_STORAGE_RUNTIME_FAILED"}');process.exitCode=1;});
}
