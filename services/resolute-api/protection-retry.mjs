/** Dormant, bounded independent-journal retry. No scheduler or delivery adapter. */
import {Pool} from 'pg';
import {pathToFileURL} from 'node:url';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {protectionRuntime} from '../../lib/resolute/protection-runtime.ts';
export async function retryProtectionBatch(pool,protect,{limit=50,now=Date.now,maxMs=45000}={}){
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isFinite(maxMs)||maxMs<1||maxMs>45000)throw Error('INVALID_RETRY_BOUND');
 const client=await pool.connect();const started=now();let completed=0,failed=0;
 try{
  const {rows}=await client.query(`SELECT DISTINCT clerk_user_id FROM resolute.protection_outbox
   WHERE published_at IS NULL AND next_attempt_at<=statement_timestamp() ORDER BY clerk_user_id LIMIT $1`,[limit]);
  for(const row of rows){
   if(now()-started>=maxMs)break;
   try{await protect(client,row.clerk_user_id);completed++;}catch{failed++;}
  }
  return {checked:completed+failed,completed,failed,remainingBatch:rows.length-completed-failed};
 }finally{client.release();}
}
export async function main(env=process.env){
 if(env.RESOLUTE_PROTECTION_RETRY_ENABLED!=='true')return {event:'RESOLUTE_PROTECTION_RETRY_DISABLED'};
 const config=resoluteDatabaseConfig(env.RESOLUTE_PROTECTION_DB_URL);
 if(new URL(config.connectionString).username!=='resolute_protection_writer')throw Error('SCOPED_RETRY_ROLE_REQUIRED');
 const protect=protectionRuntime(env),pool=new Pool(config);pool.on('error',()=>{});
 try{return {event:'RESOLUTE_PROTECTION_RETRY_RESULT',...await retryProtectionBatch(pool,protect)};}finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().then(result=>{console.log(JSON.stringify(result));if(result.failed||result.remainingBatch)process.exitCode=1;})
 .catch(()=>{console.error(JSON.stringify({event:'RESOLUTE_PROTECTION_RETRY_FAILED'}));process.exitCode=1;});
}
