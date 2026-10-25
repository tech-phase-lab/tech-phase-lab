import {Pool} from 'pg';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {createMailMonitor} from '../../lib/resolute/notification-mail-monitor.ts';

// Explicit operator invocation only; no cron registration or outbound mail.
let pool;
try{
 if(process.env.RESOLUTE_MAIL_MONITOR_ENABLED!=='true'){
  console.log(JSON.stringify({enabled:false}));process.exitCode=1;
 }else{
  const config=resoluteDatabaseConfig(process.env.RESOLUTE_NOTIFICATION_SENDER_DB_URL);
  if(new URL(config.connectionString).username!=='resolute_notification_sender')throw Error('Scoped sender required');
  pool=new Pool(config);pool.on('error',()=>{});
  const result=await createMailMonitor(pool,{enabled:true,apiKey:process.env.RESOLUTE_RESEND_API_KEY??'',from:process.env.RESOLUTE_MAIL_FROM??''})();
  console.log(JSON.stringify(result));
  if(result.pending||result.failed||result.unavailable||result.incomplete)process.exitCode=1;
 }
}catch{console.log(JSON.stringify({error:'MAIL_MONITOR_UNAVAILABLE'}));process.exitCode=1;}
finally{await pool?.end();}
